import { h } from 'preact'
import { useRef } from 'preact/hooks'

interface MessageInputProps {
  onSend: (text: string) => void
  disabled?: boolean
}

export function MessageInput({ onSend, disabled }: MessageInputProps) {
  const textRef = useRef<HTMLTextAreaElement>(null)

  function handleSend() {
    const el = textRef.current
    if (!el || !el.value.trim()) return
    onSend(el.value.trim())
    el.value = ''
    el.style.height = 'auto'
  }

  function handleKeyDown(e: h.JSX.TargetedKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleInput() {
    const el = textRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }

  return (
    <div class="message-input-bar">
      <textarea
        ref={textRef}
        class="message-input-field"
        placeholder="Type a message..."
        rows={1}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        disabled={disabled}
      />
      <button
        class="send-btn"
        onClick={handleSend}
        disabled={disabled}
        aria-label="Send message"
      >
        ➤
      </button>
    </div>
  )
}
