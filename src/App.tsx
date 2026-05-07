import { useAuth } from './lib/auth'
import { LoginPage } from './pages/LoginPage'
import { CoachAdmin } from './pages/CoachAdmin'
import { supabaseConfigured } from './lib/supabase'

export default function App() {
  const { session, profile, loading } = useAuth()

  if (!supabaseConfigured) {
    return <SetupNeeded />
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f3ec] text-gray-500 text-sm">
        Loading…
      </div>
    )
  }

  if (!session || !profile) {
    return <LoginPage />
  }

  if (profile.role === 'coach' || profile.role === 'super_admin') {
    return <CoachAdmin />
  }

  // Client role lands here in Phase 2
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f3ec] text-gray-600">
      <div className="text-center">
        <div className="font-bold mb-2">Client portal coming in Phase 2</div>
        <div className="text-sm">You're signed in but your client account isn't wired up yet.</div>
      </div>
    </div>
  )
}

function SetupNeeded() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f3ec] p-6">
      <div className="max-w-lg bg-white border border-gray-200 rounded-lg p-6 shadow">
        <h1 className="text-lg font-extrabold mb-2">Set up Supabase first</h1>
        <p className="text-sm text-gray-700 mb-3">
          The portal needs Supabase credentials to start. Open{' '}
          <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">README.md</code>{' '}
          and follow the <strong>First-time setup</strong> steps to:
        </p>
        <ol className="text-sm text-gray-700 list-decimal pl-5 space-y-1 mb-3">
          <li>Create a Supabase project</li>
          <li>Copy your Project URL and anon key into <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">.env.local</code></li>
          <li>Run <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">supabase/schema.sql</code> in the Supabase SQL editor</li>
          <li>Create your auth user, then run <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">bootstrap_coach(...)</code></li>
        </ol>
        <p className="text-xs text-gray-500">
          After saving <code className="bg-gray-100 px-1 rounded">.env.local</code>, restart the dev server.
        </p>
      </div>
    </div>
  )
}
