#!/usr/bin/env node

// Polyfill WebSocket for Node.js environments that lack native WebSocket
if (typeof globalThis.WebSocket === 'undefined') {
  const { WebSocket } = await import('ws')
  globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket
}

import { Command } from 'commander'
import { generateKeypair, secretKeyBytes } from './key.js'
import { getPublicKey } from 'nostr-tools'
import { Client } from './client.js'
import { RelayPool } from './pool.js'

const program = new Command()

program
  .name('nsmp')
  .description('Nostr Stealth Messaging Protocol CLI')
  .version('1.0.0')

program
  .command('generate-key')
  .description('Generate a new keypair')
  .action(() => {
    const kp = generateKeypair()
    console.log('Public key (hex):', kp.publicKey)
    console.log('Private key (hex):', kp.privateKey)
  })

program
  .command('send')
  .description('Send an NSMP message')
  .requiredOption('-k, --private-key <hex>', 'Sender private key')
  .requiredOption('-r, --recipient <hex>', 'Recipient current public key')
  .requiredOption('-m, --message <text>', 'Message plaintext')
  .option('--relays <urls>', 'Comma-separated relay URLs (6)')
  .option('-p, --pool <urls>', 'Comma-separated relay pool URLs')
  .action(async (opts) => {
    const skBytes = secretKeyBytes(opts.privateKey)
    const keypair = { privateKey: opts.privateKey, publicKey: getPublicKey(skBytes) }

    const pool = opts.pool
      ? opts.pool.split(',').map((s: string) => s.trim())
      : undefined
    const client = new Client(keypair, pool)

    const currentRelays = opts.relays
      ? opts.relays.split(',').map((s: string) => s.trim())
      : undefined

    const result = await client.send({
      recipientCurrentPubkey: opts.recipient,
      plaintext: opts.message,
      currentRelays,
    })
    console.log('Message sent.')
    console.log('Conversation ID:', result.conversationId)
    console.log('Reply targets:', result.replyTargets.map((k) => k.publicKey))
    console.log('Next relays:', result.nextRelays)
    client.stop()
  })

program
  .command('listen')
  .description('Listen for NSMP messages')
  .requiredOption('-k, --private-key <hex>', 'Your private key')
  .option('-p, --pool <urls>', 'Comma-separated relay pool URLs')
  .option('--maintenance', 'Enable automatic relay pool maintenance')
  .action(async (opts) => {
    const skBytes = secretKeyBytes(opts.privateKey)
    const keypair = { privateKey: opts.privateKey, publicKey: getPublicKey(skBytes) }

    let client: Client
    if (opts.maintenance) {
      const relayPool = new RelayPool()
      client = new Client(keypair, relayPool)
      await relayPool.seed()
      client.startMaintenance()
      console.log('Relay pool maintenance enabled (refresh every 30m)')
    } else {
      const pool = opts.pool
        ? opts.pool.split(',').map((s: string) => s.trim())
        : undefined
      client = new Client(keypair, pool)
    }

    client.setMessageCallback((payload, senderPubkey) => {
      console.log('\n=== Message received ===')
      console.log('Content:', payload.content)
      console.log('From:', senderPubkey ?? 'unknown')
      console.log('Shard:', payload.shard_index, '/', payload.shard_total)
      console.log('Next relays:', payload.next_relays)
      console.log('Next targets:', payload.next_targets)
      console.log('Peer relays:', payload.peer_relays)
      console.log('========================\n')
    })

    console.log('Listening on keys...')
    await client.listen()

    process.on('SIGINT', () => {
      console.log('\nStopping...')
      client.stop()
      process.exit(0)
    })

    await new Promise(() => {})
  })

program.parse(process.argv)
