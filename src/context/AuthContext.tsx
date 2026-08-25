import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/types'

type AuthValue = {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, displayName: string) => Promise<{ needsConfirm: boolean }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  /** Envoie le lien de reinitialisation par email. */
  sendReset: (email: string) => Promise<void>
  /** Change le mot de passe de la session en cours. */
  changePassword: (password: string) => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const user = session?.user ?? null

  const loadProfile = useCallback(async (account: User) => {
    const userId = account.id
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      console.error('[auth] lecture du profil', error)
      setProfile(null)
      return
    }

    if (data) {
      setProfile(data)
      return
    }

    // Filet de securite : compte cree avant le trigger on_auth_user_created.
    // Sans cette ligne l'app resterait sans profil apres le login.
    const fallbackName =
      (account.user_metadata?.display_name as string | undefined) ??
      account.email?.split('@')[0] ??
      null
    const { data: created, error: insertError } = await supabase
      .from('profiles')
      .insert({ id: userId, display_name: fallbackName })
      .select()
      .single()

    if (insertError) {
      console.error('[auth] creation du profil manquant', insertError)
      setProfile(null)
      return
    }
    setProfile(created)
  }, [])

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      if (!data.session) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return
      setSession(next)
      if (!next) {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!user) return
    let active = true
    setLoading(true)
    loadProfile(user).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
  }, [user, loadProfile])

  const value = useMemo<AuthValue>(
    () => ({
      session,
      user,
      profile,
      loading,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      },
      async signUp(email, password, displayName) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: displayName } },
        })
        if (error) throw error
        // Si la confirmation par email est active, aucune session n'est ouverte
        return { needsConfirm: !data.session }
      },
      async signOut() {
        await supabase.auth.signOut()
      },
      async sendReset(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          // Le lien ramene sur cette page, ou la session de recuperation
          // permet de choisir un nouveau mot de passe.
          redirectTo: `${window.location.origin}/motdepasse`,
        })
        if (error) throw error
      },
      async changePassword(password) {
        const { error } = await supabase.auth.updateUser({ password })
        if (error) throw error
      },
      async refreshProfile() {
        if (user) await loadProfile(user)
      },
    }),
    [session, user, profile, loading, loadProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth doit etre utilise dans AuthProvider')
  return ctx
}
