import { Client } from '../../../src/client.js'
import type { KeyPair, ShardPayload, SyncMessage } from '../../../src/models.js'
import { addMessage, updateMessageStatus, setConversationName, conversations } from '../stores/conversations.js'
import { bootstrapRelays, RelayPool } from '../../../src/pool.js'
import { loadPendingRounds, savePendingRound, clearConversationRounds } from '../stores/pending.js'

let client: Client | null = null
let myPubkey = ''
let relayWorker: Worker | null = null

const DEDUP_MS = 3000

function isRecentSend(cid: string, content: string): string | null {
  const conv = conversations.value.get(cid)
  if (!conv || conv.messages.length === 0) return null
  const last = conv.messages[conv.messages.length - 1]
  if (
    last.content === content &&
    last.isSent &&
    Date.now() - last.timestamp < DEDUP_MS
  ) {
    return last.id
  }
  return null
}

function nextMsgIndex(cid: string): number {
  const conv = conversations.value.get(cid)
  if (!conv) return 1
  const sent = conv.messages.filter((m) => m.isSent)
  const max = sent.reduce((max, m) => Math.max(max, m.senderMsgIndex ?? 0), 0)
  return max + 1
}

async function cleanupPendingRound(cid: string): Promise<void> {
  const map = await loadPendingRounds()
  const rounds = map.get(cid)
  if (!rounds) return

  for (const round of rounds) {
    client?.destroyReplyTargets(round.replyTargets.map((kp) => kp.publicKey))
  }
  await clearConversationRounds(cid)
}

async function handleSyncRequest(payload: ShardPayload, conversationId: string): Promise<void> {
  if (!client || payload.sync?.type !== 'request') return

  const conv = conversations.value.get(conversationId)
  if (!conv) return

  const lastSeen = payload.sync.last_seen_index
  const missing = conv.messages.filter(
    (m) => m.isSent && (m.senderMsgIndex ?? 0) > lastSeen,
  )
  if (missing.length === 0) return

  const syncMessages: SyncMessage[] = missing.map((m) => ({
    sender_msg_index: m.senderMsgIndex ?? 0,
    content: m.content,
    timestamp: m.timestamp,
  }))

  const lastIncoming = conv.messages.filter((m) => !m.isSent).pop()
  const recipientPubkey = lastIncoming?.peerTargets?.[0] ?? conv.recipientPubkey
  const currentRelays = lastIncoming?.peerRelays ?? client.getRelayPool().slice(0, 6)

  await client.sendSyncBundle({
    messages: syncMessages,
    recipientCurrentPubkey: recipientPubkey,
    currentRelays,
    conversationId,
  })
}

async function handleSyncBundle(payload: ShardPayload, conversationId: string): Promise<void> {
  if (payload.sync?.type !== 'bundle') return

  for (const msg of payload.sync.messages) {
    const conv = conversations.value.get(conversationId)
    const exists = conv?.messages.some(
      (m) => !m.isSent && m.senderMsgIndex === msg.sender_msg_index,
    )
    if (exists) continue

    addMessage(conversationId, {
      conversationId,
      content: msg.content,
      timestamp: msg.timestamp,
      isSent: false,
      senderPubkey: '',
      senderMsgIndex: msg.sender_msg_index,
    })
  }
}

export async function startClient(keypair: KeyPair, nip07Signer?: any): Promise<Client> {
  myPubkey = keypair.publicKey

  const relayPool = new RelayPool()
  client = new Client(keypair, relayPool)
  if (nip07Signer?.nip44?.decrypt) {
    console.warn('Setting up nip44 decrypt fallback via NIP-07 extension')
    client.setNip44Decrypt(
      (senderPubkey, ciphertext) => nip07Signer.nip44!.decrypt(senderPubkey, ciphertext),
    )
  }
  await relayPool.seed()
  client.startMaintenance()
  startRelayWorker()

  client.setMessageCallback((payload: ShardPayload, matchedPubkey: string) => {
    const conversationId = payload.conversation_id ?? 'default'
    const isSent = payload.conversation?.sender === myPubkey

    console.warn('Message received:', { conversationId, isSent, content: payload.content?.slice(0, 30), matchedPubkey: matchedPubkey.slice(0, 12) })

    // Handle sync messages
    if (payload.sync) {
      if (payload.sync.type === 'request') {
        handleSyncRequest(payload, conversationId)
      }
      if (payload.sync.type === 'bundle') {
        handleSyncBundle(payload, conversationId)
      }
      return
    }

    if (isSent) {
      const existingId = isRecentSend(conversationId, payload.content)
      if (existingId) {
        updateMessageStatus(conversationId, existingId, 'sent')
        return
      }
    }

    addMessage(conversationId, {
      conversationId,
      content: payload.content,
      timestamp: Date.now(),
      isSent,
      senderPubkey: payload.conversation?.sender ?? '',
      status: isSent ? 'sent' : undefined,
      peerRelays: payload.next_relays,
      peerTargets: payload.next_targets,
      senderMsgIndex: payload.sender_msg_index,
    })

    if (payload.conversation?.recipient && payload.conversation?.sender) {
      const other = isSent ? payload.conversation.recipient : payload.conversation.sender
      if (other !== myPubkey) {
        setConversationName(conversationId, other.slice(0, 8) + '...')
      }
    }

    if (!isSent) {
      cleanupPendingRound(conversationId)
    }
  })

  // Restore any pending rounds from previous session
  const rounds = await loadPendingRounds()
  for (const [, roundList] of rounds) {
    for (const round of roundList) {
      await client.restoreRound(round)
    }
  }

  await client.listen()

  return client
}

export async function sendNSMP(
  recipientPubkey: string,
  text: string,
  conversationId?: string,
): Promise<void> {
  if (!client) throw new Error('Client not started')

  const cid = conversationId ?? recipientPubkey

  const msgId = addMessage(cid, {
    conversationId: cid,
    content: text,
    timestamp: Date.now(),
    isSent: true,
    senderPubkey: myPubkey,
    status: 'sending',
  })

  try {
    const conv = conversations.value.get(cid)
    const lastIncoming = conv?.messages.filter((m) => !m.isSent).pop()
    const index = nextMsgIndex(cid)

    let result: { replyTargets: KeyPair[]; nextRelays: string[]; conversationId: string }
    if (lastIncoming?.peerTargets && lastIncoming?.peerRelays) {
      result = await client.sendReply({
        peerTargets: lastIncoming.peerTargets,
        peerRelays: lastIncoming.peerRelays,
        replyText: text,
        conversationId: cid,
        msgIndex: index,
      })
    } else {
      result = await client.send({
        recipientCurrentPubkey: recipientPubkey,
        plaintext: text,
        conversationId: cid,
        msgIndex: index,
      })
    }

    await savePendingRound(cid, {
      replyTargets: result.replyTargets,
      nextRelays: result.nextRelays,
      createdAt: Date.now(),
    })

    updateMessageStatus(cid, msgId, 'sent')
  } catch {
    updateMessageStatus(cid, msgId, 'failed')
  }
}

export async function requestSync(conversationId: string): Promise<void> {
  if (!client) return

  const conv = conversations.value.get(conversationId)
  if (!conv) return

  const lastIncoming = conv.messages.filter((m) => !m.isSent).pop()
  if (!lastIncoming) return

  const lastSeenIndex = lastIncoming.senderMsgIndex ?? 0
  const recipientPubkey = lastIncoming.peerTargets?.[0] ?? conv.recipientPubkey
  const currentRelays = lastIncoming.peerRelays ?? bootstrapRelays().slice(0, 6)

  const result = await client.sendSyncRequest({
    lastSeenIndex,
    recipientCurrentPubkey: recipientPubkey,
    currentRelays,
    conversationId,
  })

  await savePendingRound(conversationId, {
    replyTargets: result.replyTargets,
    nextRelays: result.nextRelays,
    createdAt: Date.now(),
  })
}

function startRelayWorker(): void {
  try {
    const worker = new Worker(
      new URL('./relay-worker.ts', import.meta.url),
      { type: 'module' },
    )

    worker.onmessage = (event) => {
      if (event.data.type === 'relays' && client) {
        client.addRelays(event.data.relays)
      }
    }

    worker.onerror = (err) => {
      console.warn('Relay worker error:', err)
    }

    worker.postMessage({ command: 'start' })
    relayWorker = worker
  } catch (err) {
    console.warn('Web Worker not available, using inline refresh only:', err)
  }
}

function stopRelayWorker(): void {
  if (relayWorker) {
    relayWorker.postMessage({ command: 'stop' })
    relayWorker.terminate()
    relayWorker = null
  }
}

export function stopClient(): void {
  stopRelayWorker()
  client?.stop()
  client = null
}

export function getClient(): Client | null {
  return client
}
