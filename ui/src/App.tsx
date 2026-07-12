import { h } from 'preact'
import { useComputed } from '@preact/signals'
import { authState, getSavedAuthMethod } from './stores/auth.js'
import { LoginPage } from './pages/LoginPage.js'
import { ChatPage } from './pages/ChatPage.js'
import { useEffect } from 'preact/hooks'

export function App() {
  const auth = useComputed(() => authState.value)

  useEffect(() => {
    const saved = getSavedAuthMethod()
    if (!saved) return
  }, [])

  return auth.value ? <ChatPage /> : <LoginPage />
}
