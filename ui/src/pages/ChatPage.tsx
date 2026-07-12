import { h } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import { useComputed, useSignalEffect } from '@preact/signals'
import { conversations, activeConversationId, selectConversation } from '../stores/conversations.js'
import { fetchContacts } from '../stores/contacts.js'
import { authState } from '../stores/auth.js'
import { sendNSMP, requestSync } from '../nsmp/bridge.js'
import { Avatar } from '../components/Avatar.js'
import { ChatList } from '../components/ChatList.js'
import { MessageThread } from '../components/MessageThread.js'
import { MessageInput } from '../components/MessageInput.js'
import { SettingsDrawer } from '../components/SettingsDrawer.js'
import { NewChatDialog } from '../components/NewChatDialog.js'
import { bootstrapRelays } from '../../../src/pool.js'

function isMobile(): boolean {
  return window.innerWidth < 768
}

export function ChatPage() {
  const [showSettings, setShowSettings] = useState(false)
  const [showNewChat, setShowNewChat] = useState(false)
  const [search, setSearch] = useState('')
  const [mobileView, setMobileView] = useState<'sidebar' | 'chat'>(
    isMobile() ? 'sidebar' : 'chat'
  )
  const auth = authState.value
  const activeId = activeConversationId
  const convList = useComputed(() => conversations.value)

  // Switch to chat view on mobile when a conversation is selected
  useSignalEffect(() => {
    if (activeId.value && isMobile()) {
      setMobileView('chat')
    }
  })

  // Handle resize
  useEffect(() => {
    const onResize = () => {
      if (!isMobile()) setMobileView('chat')
    }
    addEventListener('resize', onResize)
    return () => removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (auth) {
      fetchContacts(auth.client ? bootstrapRelays() : bootstrapRelays(), auth.pubkey)
    }
  }, [auth?.pubkey])

  function handleSend(text: string) {
    const id = activeId.value
    if (!id) return
    const conv = convList.value.get(id)
    if (!conv) return
    sendNSMP(conv.recipientPubkey, text, id)
  }

  const activeConv = activeId.value ? convList.value.get(activeId.value) : null

  const showSidebar = !isMobile() || mobileView === 'sidebar'
  const showChat = !isMobile() || mobileView === 'chat'

  return (
    <div class="chat-page">
      <div class={`sidebar${showSidebar ? '' : ' mobile-hidden'}`}>
        {!showSidebar && <div class="sidebar-spacer" />}
        <div class="sidebar-header">
          <h2>NSMP</h2>
          <div class="sidebar-header-actions">
            <button class="icon-btn" onClick={() => setShowSettings(true)} title="Settings">
              ⚙
            </button>
          </div>
        </div>
        <div class="search-bar">
          <input
            class="search-input"
            placeholder="Search conversations..."
            value={search}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          />
        </div>
        <button class="newchat-fab" onClick={() => setShowNewChat(true)}>
          ✎ New Chat
        </button>
        <ChatList />
      </div>

      <div class={`chat-pane${showChat ? '' : ' mobile-hidden'}`}>
        {activeConv ? (
          <>
            <div class="chat-header">
              {isMobile() && (
                <button
                  class="icon-btn mobile-back"
                  onClick={() => setMobileView('sidebar')}
                  aria-label="Back to conversations"
                >
                  ←
                </button>
              )}
              <Avatar
                name={activeConv.recipientName}
                pubkey={activeConv.recipientPubkey}
                picture={activeConv.recipientPicture}
                small
              />
              <div>
                <div class="chat-header-name">{activeConv.recipientName}</div>
                <div class="chat-header-status">NSMP encrypted</div>
              </div>
              <div class="chat-header-spacer" />
              <button class="icon-btn" onClick={() => requestSync(activeConv.id)} title="Request sync">🔄</button>
            </div>
            <MessageThread />
            <MessageInput onSend={handleSend} />
          </>
        ) : (
          <div class="chat-empty">
            <div class="chat-empty-icon">💬</div>
            <p class="chat-empty-text">Select a conversation or start a new one</p>
            <button class="newchat-fab" onClick={() => setShowNewChat(true)} style="margin-top: 16px;">
              ✎ New Chat
            </button>
          </div>
        )}
      </div>

      {showSettings && <SettingsDrawer onClose={() => setShowSettings(false)} />}
      {showNewChat && <NewChatDialog onClose={() => setShowNewChat(false)} />}
    </div>
  )
}
