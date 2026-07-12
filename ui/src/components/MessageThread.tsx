import { h } from 'preact'
import { useSignalEffect } from '@preact/signals'
import { useRef, useState } from 'preact/hooks'
import { activeConversationId, getActiveThread } from '../stores/conversations.js'
import type { UIMessage } from '../stores/conversations.js'
import { MessageBubble } from './MessageBubble.js'

function groupByDate(messages: UIMessage[]) {
  const groups: { date: string; messages: UIMessage[] }[] = []
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
  const [messages, setMessages] = useState<UIMessage[]>(() => getActiveThread())

  useSignalEffect(() => {
    setMessages(getActiveThread())
  })

  useSignalEffect(() => {
    getActiveThread()
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    })
  })

  if (!activeId.value) return null

  const groups = groupByDate(messages)

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
              status={msg.status}
            />
          ))}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
