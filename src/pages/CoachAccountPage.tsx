import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useDirtyGuard } from '../lib/dirtyGuard'
import { Card } from '../components/Card'
import { SaveBar } from '../components/SaveBar'
import { DarkField } from '../components/DarkField'
import { ChangePasswordForm } from '../components/ChangePasswordForm'

// =============================================================================
// Coach Account page — third tab in Coach Admin (Clients / Industries / Account).
// Lets the coach manage their own profile (display name), brand info shown to
// clients (brand name, footer, primary color, support/from emails), and
// password. Email is read-only (login key, same rule as activated clients).
// =============================================================================

type Props = {
  onLeave: () => void
}

export function CoachAccountPage({ onLeave }: Props) {
  const { session, profile, coach, refreshProfile } = useAuth()

  const [displayName, setDisplayName] = useState('')
  const [brandName, setBrandName] = useState('')
  const [brandFooter, setBrandFooter] = useState('')
  const [brandColor, setBrandColor] = useState('')
  const [supportEmail, setSupportEmail] = useState('')
  const [fromEmail, setFromEmail] = useState('')

  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setDisplayName(profile?.display_name ?? '')
  }, [profile])

  useEffect(() => {
    setBrandName(coach?.brand_name ?? '')
    setBrandFooter(coach?.brand_footer_text ?? '')
    setBrandColor(coach?.brand_primary_color ?? '')
    setSupportEmail(coach?.support_email ?? '')
    setFromEmail(coach?.from_email ?? '')
  }, [coach])

  const initial = useMemo(
    () => ({
      displayName: profile?.display_name ?? '',
      brandName: coach?.brand_name ?? '',
      brandFooter: coach?.brand_footer_text ?? '',
      brandColor: coach?.brand_primary_color ?? '',
      supportEmail: coach?.support_email ?? '',
      fromEmail: coach?.from_email ?? '',
    }),
    [profile, coach]
  )

  const isDirty =
    displayName !== initial.displayName ||
    brandName !== initial.brandName ||
    brandFooter !== initial.brandFooter ||
    brandColor !== initial.brandColor ||
    supportEmail !== initial.supportEmail ||
    fromEmail !== initial.fromEmail

  const setGuardDirty = useDirtyGuard(isDirty)

  const onSave = async () => {
    if (!profile || !coach) return
    setSaving(true)
    setSaveError(null)

    const profileUpdate = supabase
      .from('profiles')
      .update({ display_name: displayName.trim() || null })
      .eq('id', profile.id)

    const coachUpdate = supabase
      .from('coaches')
      .update({
        brand_name: brandName.trim(),
        brand_footer_text: brandFooter.trim() || null,
        brand_primary_color: brandColor.trim() || null,
        support_email: supportEmail.trim() || null,
        from_email: fromEmail.trim() || null,
      })
      .eq('id', coach.id)

    const [pRes, cRes] = await Promise.all([profileUpdate, coachUpdate])
    setSaving(false)
    if (pRes.error || cRes.error) {
      setSaveError((pRes.error ?? cRes.error)?.message ?? 'Save failed.')
      return
    }
    setSavedAt(Date.now())
    setGuardDirty(false)
    await refreshProfile()
  }

  const onCancel = () => {
    if (
      isDirty &&
      !confirm(
        'You have unsaved changes. Leave without saving? Click OK to continue or Cancel to stay.'
      )
    )
      return
    setDisplayName(initial.displayName)
    setBrandName(initial.brandName)
    setBrandFooter(initial.brandFooter)
    setBrandColor(initial.brandColor)
    setSupportEmail(initial.supportEmail)
    setFromEmail(initial.fromEmail)
    setSavedAt(null)
    setSaveError(null)
    setGuardDirty(false)
    onLeave()
  }

  if (!profile || !coach) {
    return <div className="text-black text-sm">Loading…</div>
  }

  const email = session?.user.email ?? ''

  return (
    <section className="space-y-4">
      <div className="sticky top-[84px] z-20 bg-[#dad7c5] -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 -mt-6 flex flex-wrap justify-between items-center gap-3">
        <h1 className="text-ink text-lg font-bold">Account</h1>
        <SaveBar
          isDirty={isDirty}
          saving={saving}
          savedAt={savedAt}
          onCancel={onCancel}
          onSave={onSave}
        />
      </div>

      {saveError && (
        <div className="bg-red-50 border border-red-300 text-red-800 text-sm rounded p-3">
          {saveError}
        </div>
      )}

      {/* Row 1: Profile + Brand */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Profile">
          <DarkField
            label="Display Name"
            value={displayName}
            onChange={setDisplayName}
            placeholder="Jackie Ferrier"
          />
          <DarkField
            label="Email (login)"
            value={email}
            onChange={() => {}}
            disabled
            hint="Email is the login key and can't be changed here."
          />
        </Card>

        <Card title="Brand">
          <DarkField
            label="Brand Name"
            value={brandName}
            onChange={setBrandName}
            placeholder="The Good Plans Co"
            hint="Shown at the top of every client's portal and in admin headers."
          />
          <DarkField
            label="Brand Footer Text"
            value={brandFooter}
            onChange={setBrandFooter}
            placeholder="© The Good Plans Co"
            hint="Optional. Shown in the footer of every client portal."
          />
          <BrandColorRow value={brandColor} onChange={setBrandColor} />
          <DarkField
            label="Support Email"
            type="email"
            value={supportEmail}
            onChange={setSupportEmail}
            placeholder="support@thegoodplansco.com"
            hint="Optional. Used as the contact email shown to clients."
          />
          <DarkField
            label="From Email"
            type="email"
            value={fromEmail}
            onChange={setFromEmail}
            placeholder="noreply@thegoodplansco.com"
            hint="Optional. Used as the from address on system emails (deploy-time config required)."
          />
        </Card>
      </div>

      {/* Row 2: Change Password */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Change Password">
          <ChangePasswordForm email={email} />
        </Card>
      </div>

    </section>
  )
}

function BrandColorRow({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const looksLikeHex = /^#[0-9a-fA-F]{6}$/.test(value.trim())
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider text-white mb-1">
        Brand Primary Color
      </label>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#f2c94c"
          className="flex-1 bg-white border-2 border-accent ring-1 ring-inset ring-black text-black rounded text-sm px-3 py-2 focus:outline-none"
        />
        <div
          className="w-9 h-9 rounded border border-line"
          style={{
            backgroundColor: looksLikeHex ? value.trim() : 'transparent',
          }}
          aria-hidden
        />
      </div>
      <div className="text-xs text-white mt-1">
        Optional hex (e.g. #f2c94c). Preview shows next to the input.
      </div>
    </div>
  )
}
