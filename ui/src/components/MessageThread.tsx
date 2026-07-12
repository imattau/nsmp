import { h } from 'preact'
import { useComputed, useSignalEffect } from '@preact/signals'
import { useRef } from 'preact/hooks'
import { conversations, activeConversationId, getActiveThread } from '../stores/conversations.js'
import { MessageBubble } from './MessageBubble.js'

function groupByDate(messages: ReturnType<typeof getActiveThread>) {
  const groups: { date: string; messages: typeof messages }[] = []
  let current: typeof groups[0] | null = null

  for (const msg of messages) {
    const d = new Date(msg.timestamp).toLocaleDateString()
    if (!current || current.date !== d) {
      current = { date: d, messages: [] }
      groups.push(current)
    }
    current.messages.push(msg)
  }

  return groups
}

export function MessageThread() {
  const bottomRef = useRef<HTMLDivElement>(null)
  const activeId = activeConversationId
  const thread = useComputed(() => getActiveThread())

  useSignalEffect(() => {
    thread.value // subscribe
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    })
  })

  if (!activeId.value) return null

  const groups = groupByDate(thread.value)

  return (
    <div class="message-thread">
      {groups.map((g) => (
        <div key={g.date}>
          <div class="date-separator">{g.date}</div>
          {g.messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              content={msg.content}
              timestamp={msg.timestamp}
              isSent={msg.isSent}
            />
          ))}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
