import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Coach, Profile } from './types'

type AuthState = {
  session: Session | null
  profile: Profile | null
  coach: Coach | null
  loading: boolean
  /** True while the user is signed in via a password-recovery link (i.e.
   *  the email reset flow). App renders a "set new password" page while
   *  this is true. Cleared by completePasswordRecovery once the user
   *  picks a new password. */
  isRecoverySession: boolean
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  completePasswordRecovery: () => void
  /** Re-fetch the profile + coach rows from the DB. Call this after editing
   *  display_name / brand fields so the header re-renders with fresh values. */
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [coach, setCoach] = useState<Coach | null>(null)
  const [loading, setLoading] = useState(true)
  const [isRecoverySession, setIsRecoverySession] = useState(false)

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session)
      if (!data.session) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession)
      // Email password-recovery flow: Supabase fires PASSWORD_RECOVERY
      // when the user lands via the reset email link. The app renders a
      // "set new password" page until completePasswordRecovery() fires.
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecoverySession(true)
      }
      if (!newSession) {
        setProfile(null)
        setCoach(null)
        setLoading(false)
        setIsRecoverySession(false)
      }
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  // Re-fetch the profile + coach record only when the AUTH USER ACTUALLY
  // CHANGES — not on every session-object change. Supabase fires
  // onAuthStateChange events (TOKEN_REFRESHED, USER_UPDATED) every time the
  // tab regains focus, which would otherwise unmount and remount the entire
  // logged-in tree and reset client-side state (e.g. the active nav tab).
  const userId = session?.user.id ?? null

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setLoading(true)

    ;(async () => {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()

      if (cancelled) return

      if (profileError || !profileData) {
        setProfile(null)
        setCoach(null)
        setLoading(false)
        return
      }

      setProfile(profileData as Profile)

      if (profileData.coach_id) {
        const { data: coachData } = await supabase
          .from('coaches')
          .select('*')
          .eq('id', profileData.coach_id)
          .maybeSingle()
        if (!cancelled) setCoach((coachData as Coach) ?? null)
      }

      if (!cancelled) setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [userId])

  const signInWithPassword = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  const completePasswordRecovery = () => setIsRecoverySession(false)

  const refreshProfile = async () => {
    if (!userId) return
    const { data: profileData } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    if (profileData) {
      setProfile(profileData as Profile)
      if (profileData.coach_id) {
        const { data: coachData } = await supabase
          .from('coaches')
          .select('*')
          .eq('id', profileData.coach_id)
          .maybeSingle()
        setCoach((coachData as Coach) ?? null)
      }
    }
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        coach,
        loading,
        isRecoverySession,
        signInWithPassword,
        signOut,
        completePasswordRecovery,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
