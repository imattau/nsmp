import { Client } from '../../../src/client.js'
import type { KeyPair, ShardPayload } from '../../../src/models.js'
import { addMessage, updateMessageStatus, setConversationName } from '../stores/conversations.js'
import { bootstrapRelays } from '../../../src/pool.js'

let client: Client | null = null
let myPubkey = ''

export async function startClient(keypair: KeyPair, nip07Signer?: any): Promise<Client> {
  myPubkey = keypair.publicKey
  client = new Client(keypair, bootstrapRelays())

  client.setMessageCallback((payload: ShardPayload) => {
    const conversationId = payload.conversation_id ?? 'default'
    const isSent = payload.conversation?.sender === myPubkey

    addMessage(conversationId, {
      conversationId,
      content: payload.content,
      timestamp: Date.now(),
      isSent,
      senderPubkey: payload.conversation?.sender ?? '',
    })

    if (payload.conversation?.recipient && payload.conversation?.sender) {
      const other = isSent ? payload.conversation.recipient : payload.conversation.sender
      if (other !== myPubkey) {
        setConversationName(conversationId, other.slice(0, 8) + '...')
      }
    }
  })

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

  // Show immediately with "sending" indicator
  const msgId = addMessage(cid, {
    conversationId: cid,
    content: text,
    timestamp: Date.now(),
    isSent: true,
    senderPubkey: myPubkey,
    status: 'sending',
  })

  // Publish to relays
  try {
    await client.send({
      recipientCurrentPubkey: recipientPubkey,
      plaintext: text,
      conversationId: cid,
    })
    updateMessageStatus(cid, msgId, 'sent')
  } catch {
    updateMessageStatus(cid, msgId, 'failed')
  }
}

export function stopClient(): void {
  client?.stop()
  client = null
}

export function getClient(): Client | null {
  return client
}
