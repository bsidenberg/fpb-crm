import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

export function usePresence({ channelKey, userEmail, userDisplayName }) {
  const [otherViewers, setOtherViewers] = useState([])
  const channelRef = useRef(null)

  useEffect(() => {
    // Don't subscribe if we don't have a channel key or user identity
    if (!channelKey || !userEmail) return

    const joinedAt = Date.now()
    const channel = supabase.channel(channelKey, {
      config: {
        presence: { key: userEmail },  // dedupe by email — same user in two tabs counts once
      },
    })

    channelRef.current = channel

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        // state is { email1: [{...payload}], email2: [{...payload}] }
        const everyone = Object.entries(state).flatMap(([email, payloads]) => {
          // each user might have multiple "presences" (e.g., two tabs); take the first
          const p = payloads[0]
          return [{
            email,
            displayName: p.displayName,
            joinedAt: p.joinedAt,
          }]
        })
        // exclude self
        const others = everyone.filter(v => v.email !== userEmail)
        setOtherViewers(others)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            displayName: userDisplayName || userEmail,
            joinedAt,
          })
        }
      })

    return () => {
      channel.unsubscribe()
      supabase.removeChannel(channel)
      channelRef.current = null
    }
  }, [channelKey, userEmail, userDisplayName])

  return { otherViewers }
}
