import { h } from 'preact'
import { authState, clearAuth } from '../stores/auth.js'
import { stopClient } from '../nsmp/bridge.js'

interface SettingsDrawerProps {
  onClose: () => void
}

export function SettingsDrawer({ onClose }: SettingsDrawerProps) {
  const auth = authState.value

  function handleLogout() {
    stopClient()
    clearAuth()
    authState.value = null
  }

  function handleOverlayClick(e: h.JSX.TargetedMouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div class="settings-overlay" onClick={handleOverlayClick}>
      <div class="settings-drawer">
        <div class="settings-header">
          <h3>Settings</h3>
          <button class="icon-btn" onClick={onClose} aria-label="Close settings">
            ✕
          </button>
        </div>
        <div class="settings-body">
          <div class="settings-section">
            <h4>Account</h4>
            <div class="settings-row">
              <span>Login method</span>
              <span class="settings-value">{auth?.loginMethod ?? '-'}</span>
            </div>
            <div class="settings-row">
              <span>Public key</span>
              <span class="settings-value" title={auth?.pubkey}>
                {auth?.pubkey ? auth.pubkey.slice(0, 16) + '...' : '-'}
              </span>
            </div>
          </div>
          <div class="settings-section">
            <h4>NSMP</h4>
            <div class="settings-row">
              <span>Status</span>
              <span class="settings-value" style="color: #22c55e;">Connected</span>
            </div>
          </div>

          {auth?.client && (
            <div class="settings-section">
              <h4>Relays</h4>
              <div class="settings-relays">
                {auth.client.getRelayPool().map((url) => (
                  <div class="settings-relay-item" key={url}>{url}</div>
                ))}
                {auth.client.getRelayPool().length === 0 && (
                  <div class="settings-relay-item" style="color: var(--text-muted)">No relays connected</div>
                )}
              </div>
            </div>
          )}
          <button class="settings-logout" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </div>
    </div>
  )
}
