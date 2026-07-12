import { h } from 'preact'
import type { MessageStatus } from '../stores/conversations.js'

interface MessageBubbleProps {
  content: string
  timestamp: number
  isSent: boolean
  status?: MessageStatus
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0')
}

function statusIcon(status?: MessageStatus): string {
  switch (status) {
    case 'sending': return '⋯'
    case 'sent': return '✓'
    case 'failed': return '⚠'
    default: return ''
  }
}

function statusTitle(status?: MessageStatus): string {
  switch (status) {
    case 'sending': return 'Sending…'
    case 'sent': return 'Sent'
    case 'failed': return 'Send failed'
    default: return ''
  }
}

export function MessageBubble({ content, timestamp, isSent, status }: MessageBubbleProps) {
  return (
    <div class={`message-row ${isSent ? 'sent' : 'received'}`}>
      <div class={`message-bubble ${isSent ? 'sent' : 'received'}`}>
        <div>{content}</div>
        <div class="message-meta">
          <span class="message-time">{formatTime(timestamp)}</span>
          {isSent && status && (
            <span
              class={`message-status ${status}`}
              title={statusTitle(status)}
            >
              {statusIcon(status)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
