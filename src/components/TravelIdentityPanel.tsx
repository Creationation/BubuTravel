import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { errorMessage } from '../lib/errors'
import { useI18n } from '../i18n/I18nContext'

/**
 * Nationalite et pays de residence : ils servent a trouver, pour chaque pays
 * du voyage, l'ambassade de VOTRE pays et les numeros d'urgence utiles
 * (pays visite et pays de residence). Ranges ensuite dans le coffre.
 */
export default function TravelIdentityPanel() {
  const { t, lang } = useI18n()
  const { user, profile, refreshProfile } = useAuth()
  const p = profile as (typeof profile & { nationality?: string | null; residence_country?: string | null }) | null
  const [nat, setNat] = useState('')
  const [res, setRes] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setNat(p?.nationality ?? '')
    setRes(p?.residence_country ?? '')
  }, [p?.nationality, p?.residence_country])

  // Liste des pays, dans la langue choisie, pour la saisie assistee
  const countries = useMemo(() => {
    try {
      const dn = new Intl.DisplayNames([lang], { type: 'region' })
      const out: string[] = []
      const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
      for (const a of A)
        for (const b of A) {
          const n = dn.of(a + b)
          if (n && n !== a + b && !out.includes(n)) out.push(n)
        }
      return out.sort((x, y) => x.localeCompare(y, lang))
    } catch {
      return []
    }
  }, [lang])

  async function save() {
    if (!user) return
    setError(null)
    const { error: err } = await supabase
      .from('profiles')
      .update({ nationality: nat.trim() || null, residence_country: res.trim() || null } as never)
      .eq('id', user.id)
    if (err) {
      setError(errorMessage(err))
      return
    }
    await refreshProfile()
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1800)
  }

  return (
    <section className="panel p-6 sm:p-8">
      <h2 className="display-sm text-2xl">🛂 {t('tid.title')}</h2>
      <p className="lede mt-2 text-[14px]">{t('tid.intro')}</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label>
          <span className="label">{t('tid.nationality')}</span>
          <input className="field" list="tid-countries" value={nat} onChange={(e) => setNat(e.target.value)} placeholder={t('tid.natPh')} />
        </label>
        <label>
          <span className="label">{t('tid.residence')}</span>
          <input className="field" list="tid-countries" value={res} onChange={(e) => setRes(e.target.value)} placeholder={t('tid.resPh')} />
        </label>
      </div>
      <datalist id="tid-countries">
        {countries.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <button onClick={() => void save()} className="btn btn-accent mt-4">
        {saved ? t('common.saved') : t('common.save')}
      </button>
      {error && <p className="notice notice-bad mt-3">{error}</p>}
    </section>
  )
}
