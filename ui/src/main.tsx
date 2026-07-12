import { h, render } from 'preact'
import { App } from './App.js'
import { conversations } from './stores/conversations.js'
import { loadConversations } from './stores/db.js'
import './styles/global.css'
import './styles/login.css'
import './styles/chat.css'

async function init() {
  const saved = await loadConversations()
  if (saved.size > 0) {
    conversations.value = saved
  }

  const root = document.getElementById('app')
  if (root) {
    render(<App />, root)
  }
}

init()
