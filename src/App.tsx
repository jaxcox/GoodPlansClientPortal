import { useState } from 'react'
import { useAuth } from './lib/auth'
import { LoginPage } from './pages/LoginPage'
import { CoachAdmin } from './pages/CoachAdmin'
import { ClientPortal } from './pages/ClientPortal'
import { supabaseConfigured } from './lib/supabase'
import { DirtyGuardProvider } from './lib/dirtyGuard'
import { ResetPasswordRecoveryPage } from './components/ResetPasswordRecoveryPage'

export default function App() {
  return (
    <DirtyGuardProvider>
      <AppInner />
    </DirtyGuardProvider>
  )
}

function AppInner() {
  const { session, profile, loading, isRecoverySession } = useAuth()
  const [viewingClientId, setViewingClientId] = useState<string | null>(null)

  if (!supabaseConfigured) {
    return <SetupNeeded />
  }

  // Password-recovery email link landed the user here — show the new-password
  // form before any normal routing, regardless of role.
  if (isRecoverySession) {
    return <ResetPasswordRecoveryPage />
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f3ec] text-black text-sm">
        Loading…
      </div>
    )
  }

  if (!session || !profile) {
    return <LoginPage />
  }

  // Coach (or super_admin) view
  if (profile.role === 'coach' || profile.role === 'super_admin') {
    if (viewingClientId) {
      return (
        <ClientPortal
          clientId={viewingClientId}
          coachView
          onBack={() => setViewingClientId(null)}
        />
      )
    }
    return <CoachAdmin onViewPortal={(id) => setViewingClientId(id)} />
  }

  // Client view
  if (profile.role === 'client' && profile.client_id) {
    return <ClientPortal clientId={profile.client_id} coachView={false} />
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f3ec] text-black p-6">
      <div className="text-center">
        <div className="font-bold mb-2">Account not fully set up</div>
        <div className="text-sm">
          You're signed in but your profile isn't linked to a client record yet.
        </div>
      </div>
    </div>
  )
}

function SetupNeeded() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f3ec] p-6">
      <div className="max-w-lg bg-white border border-gray-200 rounded-lg p-6 shadow">
        <h1 className="text-lg font-extrabold mb-2">Set up Supabase first</h1>
        <p className="text-sm text-black mb-3">
          The portal needs Supabase credentials to start. Open{' '}
          <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">README.md</code>{' '}
          and follow the <strong>First-time setup</strong> steps to:
        </p>
        <ol className="text-sm text-black list-decimal pl-5 space-y-1 mb-3">
          <li>Create a Supabase project</li>
          <li>Copy your Project URL and anon key into <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">.env.local</code></li>
          <li>Run <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">supabase/schema.sql</code> in the Supabase SQL editor</li>
          <li>Create your auth user, then run <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">bootstrap_coach(...)</code></li>
        </ol>
        <p className="text-xs text-black">
          After saving <code className="bg-gray-100 px-1 rounded">.env.local</code>, restart the dev server.
        </p>
      </div>
    </div>
  )
}
