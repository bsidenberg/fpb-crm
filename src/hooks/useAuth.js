import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getDisplayName } from '../lib/users'

export function useAuth() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  return {
    user,
    loading,
    email: user?.email ?? null,
    displayName: user ? getDisplayName(user.email) : null,
    signOut: () => supabase.auth.signOut(),
  }
}
