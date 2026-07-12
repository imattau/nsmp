import { h } from 'preact'
import { useComputed } from '@preact/signals'
import { conversations, activeConversationId, selectConversation, deleteConversation, type UIConversation } from '../stores/conversations.js'
import { Avatar } from './Avatar.js'

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) {
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0')
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function sortConversations(convs: Map<string, UIConversation>): UIConversation[] {
  return Array.from(convs.values()).sort((a, b) => b.lastTimestamp - a.lastTimestamp)
}

export function ChatList() {
  const sorted = useComputed(() => sortConversations(conversations.value))
  const activeId = activeConversationId

  return (
    <div class="conversation-list">
      {sorted.value.length === 0 && (
        <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          No conversations yet.
        </div>
      )}
      {sorted.value.map((conv) => (
        <div
          key={conv.id}
          class={`conversation-item${conv.id === activeId.value ? ' active' : ''}`}
          onClick={() => selectConversation(conv.id)}
        >
          <Avatar
            name={conv.recipientName}
            pubkey={conv.recipientPubkey}
            picture={conv.recipientPicture}
          />
          <div class="conversation-info">
            <div class="conversation-name">
              <span>{conv.recipientName}</span>
              <span class="conversation-time">
                {conv.lastTimestamp > 0 ? formatTime(conv.lastTimestamp) : ''}
              </span>
            </div>
            <div class="conversation-preview">
              {conv.messages.length > 0 ? conv.messages[conv.messages.length - 1].content : ''}
            </div>
          </div>
          {conv.unread > 0 && (
            <div class="conversation-unread">{conv.unread}</div>
          )}
          <button
            class="conversation-delete"
            onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id) }}
            title="Delete conversation"
            aria-label="Delete conversation"
          >
            🗑
          </button>
        </div>
      ))}
    </div>
  )
}
