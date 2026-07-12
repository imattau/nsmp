import { h } from 'preact'
import { useState } from 'preact/hooks'

const AVATAR_COLORS = [
  '#8774e1', '#2b5278', '#dc2626', '#059669',
  '#d97706', '#2563eb', '#7c3aed', '#db2777',
  '#0891b2', '#65a30d', '#ca8a04', '#be185d',
]

function hashColor(pubkey: string): string {
  let hash = 0
  for (let i = 0; i < pubkey.length; i++) {
    hash = ((hash << 5) - hash) + pubkey.charCodeAt(i)
    hash = hash & hash
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function initial(name: string): string {
  return (name[0] ?? '?').toUpperCase()
}

interface AvatarProps {
  name: string
  pubkey?: string
  picture?: string
  small?: boolean
}

export function Avatar({ name, pubkey, picture, small }: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false)

  if (picture && !imgFailed) {
    return (
      <img
        class={`avatar${small ? ' small' : ''}`}
        src={picture}
        alt={name}
        title={name}
        onError={() => setImgFailed(true)}
        style={{ objectFit: 'cover' }}
      />
    )
  }

  const bg = pubkey ? hashColor(pubkey) : '#52525b'
  return (
    <div
      class={`avatar${small ? ' small' : ''}`}
      style={{ background: bg }}
      title={name}
    >
      {initial(name)}
    </div>
  )
}
