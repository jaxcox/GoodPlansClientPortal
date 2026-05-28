import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useDirtyGuard } from '../lib/dirtyGuard'
import { Card } from '../components/Card'
import { SaveBar } from '../components/SaveBar'
import { DarkField } from '../components/DarkField'
import { formatPhone } from '../lib/phone'

// =============================================================================
// Account page — admin-only (Phase B gating). Company-level information only:
// brand (what clients see) + company (internal business info: address, phone,
// website). Personal profile and password live elsewhere:
//   - Full Name + Phone → edited from the coach's own card on the Team tab
//   - Password         → Forgot Password on the sign-in screen
// =============================================================================

type Props = {
  onLeave: () => void
}

export function CoachAccountPage({ onLeave }: Props) {
  const { profile, coach, refreshProfile } = useAuth()

  const [brandName, setBrandName] = useState('')
  const [brandFooter, setBrandFooter] = useState('')
  const [brandColor, setBrandColor] = useState('')
  const [companyAddress, setCompanyAddress] = useState('')
  const [companyPhone, setCompanyPhone] = useState('')
  const [companyWebsite, setCompanyWebsite] = useState('')

  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setBrandName(coach?.brand_name ?? '')
    setBrandFooter(coach?.brand_footer_text ?? '')
    setBrandColor(coach?.brand_primary_color ?? '')
    setCompanyAddress(coach?.brand_address ?? '')
    setCompanyPhone(formatPhone(coach?.brand_phone ?? ''))
    setCompanyWebsite(coach?.brand_website ?? '')
  }, [coach])

  const initial = useMemo(
    () => ({
      brandName: coach?.brand_name ?? '',
      brandFooter: coach?.brand_footer_text ?? '',
      brandColor: coach?.brand_primary_color ?? '',
      companyAddress: coach?.brand_address ?? '',
      companyPhone: coach?.brand_phone ?? '',
      companyWebsite: coach?.brand_website ?? '',
    }),
    [coach]
  )

  const isDirty =
    brandName !== initial.brandName ||
    brandFooter !== initial.brandFooter ||
    brandColor !== initial.brandColor ||
    companyAddress !== initial.companyAddress ||
    companyPhone !== initial.companyPhone ||
    companyWebsite !== initial.companyWebsite

  const setGuardDirty = useDirtyGuard(isDirty)

  const onSave = async () => {
    if (!coach) return
    setSaving(true)
    setSaveError(null)

    const { error } = await supabase
      .from('coaches')
      .update({
        brand_name: brandName.trim(),
        brand_footer_text: brandFooter.trim() || null,
        brand_primary_color: brandColor.trim() || null,
        brand_address: companyAddress.trim() || null,
        brand_phone: companyPhone.trim() || null,
        brand_website: companyWebsite.trim() || null,
      })
      .eq('id', coach.id)
    if (error) {
      setSaving(false)
      setSaveError(error.message)
      return
    }

    setSaving(false)
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
    setBrandName(initial.brandName)
    setBrandFooter(initial.brandFooter)
    setBrandColor(initial.brandColor)
    setCompanyAddress(initial.companyAddress)
    setCompanyPhone(formatPhone(initial.companyPhone))
    setCompanyWebsite(initial.companyWebsite)
    setSavedAt(null)
    setSaveError(null)
    setGuardDirty(false)
    onLeave()
  }

  if (!profile || !coach) {
    return <div className="text-black text-sm">Loading…</div>
  }

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Brand">
          <DarkField
            label="Brand Name"
            value={brandName}
            onChange={setBrandName}
            placeholder="The Good Plans Co"
            info="Shown at the top of every client's portal and in admin headers."
          />
          <DarkField
            label="Brand Footer Text"
            value={brandFooter}
            onChange={setBrandFooter}
            placeholder="© The Good Plans Co"
            info="Optional. Shown in the footer of every client portal."
          />
          <BrandColorRow value={brandColor} onChange={setBrandColor} />
        </Card>

        <Card title="Company">
          <DarkField
            label="Company Address"
            value={companyAddress}
            onChange={setCompanyAddress}
            placeholder="123 Main St, Suite 4, City, ST 00000"
          />
          <DarkField
            label="Company Phone"
            type="tel"
            value={companyPhone}
            onChange={(v) => setCompanyPhone(formatPhone(v))}
            placeholder="(555)555-0100"
          />
          <DarkField
            label="Company Website"
            type="url"
            value={companyWebsite}
            onChange={setCompanyWebsite}
            placeholder="https://thegoodplansco.com"
          />
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
    </div>
  )
}
