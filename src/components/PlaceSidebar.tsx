import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { deletePhoto, fetchPhotos, signPhotoUrls, uploadPhoto } from '../lib/api'
import type { Photo, Place } from '../lib/types'
import { usePlaces } from '../context/PlacesContext'
import { useAuth } from '../context/AuthContext'
import { formatDate } from '../lib/stats'
import Lightbox from './Lightbox'
import PlaceExtras, { CURRENCIES, PRICE_LEVELS, Stars } from './PlaceExtras'
import { errorMessage } from '../lib/errors'
import { useT } from '../i18n/I18nContext'

type Props = {
  place: Place
  onClose: () => void
}

export default function PlaceSidebar({ place, onClose }: Props) {
  const t = useT()
  const { user } = useAuth()
  const { remove, edit, trips, categories, categoryOf, bumpPhotoCount } = usePlaces()
  const [photos, setPhotos] = useState<Photo[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    name: place.name,
    country: place.country,
    city: place.city ?? '',
    visit_date: place.visit_date ?? '',
    notes: place.notes ?? '',
    category_id: place.category_id ?? '',
    cost: place.cost === null ? '' : String(place.cost),
    currency: place.currency ?? 'EUR',
    price_level: place.price_level,
    rating: place.rating,
    review: place.review ?? '',
    promo_note: place.promo_note ?? '',
    promo_code: place.promo_code ?? '',
    promo_until: place.promo_until ?? '',
  })

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    setPhotos([])
    setUrls({})
    setConfirmDelete(false)
    setEditing(false)
    setForm({
      name: place.name,
      country: place.country,
      city: place.city ?? '',
      visit_date: place.visit_date ?? '',
      notes: place.notes ?? '',
      category_id: place.category_id ?? '',
      cost: place.cost === null ? '' : String(place.cost),
      currency: place.currency ?? 'EUR',
      price_level: place.price_level,
      rating: place.rating,
      review: place.review ?? '',
      promo_note: place.promo_note ?? '',
      promo_code: place.promo_code ?? '',
      promo_until: place.promo_until ?? '',
    })

    fetchPhotos(place.id)
      .then(async (list) => {
        if (!active) return
        setPhotos(list)
        const signed = await signPhotoUrls(list.map((p) => p.url))
        if (active) setUrls(signed)
      })
      .catch((err) => active && setError(errorMessage(err)))
      .finally(() => active && setLoading(false))

    return () => {
      active = false
    }
  }, [
    place.id,
    place.name,
    place.country,
    place.city,
    place.visit_date,
    place.notes,
    place.category_id,
  ])

  async function saveEdits() {
    setBusy(true)
    setError(null)
    try {
      await edit(place.id, {
        name: form.name.trim() || place.name,
        country: form.country.trim() || place.country,
        city: form.city.trim() || null,
        visit_date: form.visit_date || null,
        notes: form.notes.trim() || null,
        category_id: form.category_id || null,
        cost: form.cost.trim() ? Number(form.cost.replace(',', '.')) : null,
        currency: form.currency,
        price_level: form.price_level,
        rating: form.rating,
        review: form.review.trim() || null,
        promo_note: form.promo_note.trim() || null,
        promo_code: form.promo_code.trim() || null,
        promo_until: form.promo_until || null,
      })
      setEditing(false)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0 || !user) return
    setBusy(true)
    setError(null)
    try {
      const added: Photo[] = []
      for (const file of Array.from(files)) {
        added.push(await uploadPhoto(user.id, place.id, file))
      }
      const signed = await signPhotoUrls(added.map((p) => p.url))
      setPhotos((prev) => [...prev, ...added])
      setUrls((prev) => ({ ...prev, ...signed }))
      bumpPhotoCount(added.length)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function onDeletePhoto(photo: Photo) {
    setBusy(true)
    try {
      await deletePhoto(photo)
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id))
      bumpPhotoCount(-1)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function onDeletePlace() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setBusy(true)
    try {
      await remove(place)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  const gallery = photos.map((p) => urls[p.url]).filter(Boolean)

  return (
    <aside className="panel-enter flex max-h-[58vh] w-full shrink-0 flex-col border-t border-line bg-bg md:max-h-none md:w-[25rem] md:border-l md:border-t-0">
      <header className="border-b border-line px-6 pb-5 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">
              {place.country}
              {categoryOf(place) && ` · ${categoryOf(place)!.name}`}
            </p>
            <h2 className="display-sm mt-2 text-3xl leading-tight">{place.name}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => setEditing((v) => !v)}
              className="btn btn-xs btn-quiet"
              aria-label={t('place.editTitle')}
            >
              {editing ? t('common.cancel') : t('common.edit')}
            </button>
            <button onClick={onClose} className="btn btn-icon btn-quiet" aria-label={t('common.close')}>
              ✕
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px] text-text-muted">
          <span>{place.visit_date ? formatDate(place.visit_date) : t('place.dateUnset')}</span>
          <span className="h-1 w-1 rounded-full bg-line-strong" />
          <span className="font-mono text-[11px]">
            {place.lat.toFixed(3)}, {place.lng.toFixed(3)}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            onClick={() =>
              void edit(place.id, { status: 'visited' }).catch((err) => setError(errorMessage(err)))
            }
            className={`pill justify-center ${place.status !== 'wishlist' ? 'pill-active' : ''}`}
            disabled={busy}
          >{t('place.visitedShort')}</button>
          <button
            onClick={() =>
              void edit(place.id, { status: 'wishlist' }).catch((err) => setError(errorMessage(err)))
            }
            className={`pill justify-center ${place.status === 'wishlist' ? 'pill-active' : ''}`}
            disabled={busy}
          >{t('map.toVisit')}</button>
        </div>
      </header>

      <div className="flex-1 space-y-7 overflow-y-auto px-6 py-6">
        {/* Edition du lieu */}
        {editing && (
          <section className="space-y-3 rounded-xl border border-line bg-surface-2 p-4">
            <p className="label mb-0">{t('place.editTitle')}</p>
            <div>
              <label className="label">{t('common.name')}</label>
              <input
                className="field"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{t('common.country')}</label>
                <input
                  className="field"
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                />
              </div>
              <div>
                <label className="label">{t('common.city')}</label>
                <input
                  className="field"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="label">{t('place.visitDate')}</label>
              <input
                className="field"
                type="date"
                value={form.visit_date}
                onChange={(e) => setForm({ ...form, visit_date: e.target.value })}
              />
            </div>
            <div>
              <label className="label">{t('common.category')}</label>
              <select
                className="field"
                value={form.category_id}
                onChange={(e) => setForm({ ...form, category_id: e.target.value })}
              >
                <option value="">{t('place.noCategory')}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {categories.length === 0 && (
                <p className="mt-1.5 text-[11px] text-text-muted">{t('place.categoriesInProfile')}</p>
              )}
            </div>

            <div>
              <label className="label">{t('common.notes')}</label>
              <textarea
                className="field min-h-24 resize-y"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <div>
              <label className="label">{t('extras.yourRating')}</label>
              <Stars value={form.rating} onChange={(rating) => setForm({ ...form, rating })} />
            </div>

            <div>
              <label className="label">{t('extras.review')}</label>
              <textarea
                className="field min-h-20 resize-y"
                value={form.review}
                onChange={(e) => setForm({ ...form, review: e.target.value })}
                placeholder={t('place.reviewShort')}
              />
            </div>

            <div>
              <label className="label">{t('extras.priceRange')}</label>
              <div className="flex gap-2">
                {PRICE_LEVELS.map((lvl) => (
                  <button
                    key={lvl.value}
                    type="button"
                    title={t(lvl.hint)}
                    onClick={() =>
                      setForm({
                        ...form,
                        price_level: form.price_level === lvl.value ? null : lvl.value,
                      })
                    }
                    className={`pill flex-1 justify-center ${
                      form.price_level === lvl.value ? 'pill-active' : ''
                    }`}
                  >
                    {lvl.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="label">{t('extras.spent')}</label>
                <input
                  className="field"
                  inputMode="decimal"
                  value={form.cost}
                  onChange={(e) => setForm({ ...form, cost: e.target.value })}
                  placeholder="120"
                />
              </div>
              <div>
                <label className="label">{t('common.currency')}</label>
                <select
                  className="field"
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="label">{t('extras.deal')}</label>
              <input
                className="field"
                value={form.promo_note}
                onChange={(e) => setForm({ ...form, promo_note: e.target.value })}
                placeholder={t('place.dealShort')}
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  className="field font-mono"
                  value={form.promo_code}
                  onChange={(e) => setForm({ ...form, promo_code: e.target.value })}
                  placeholder={t('extras.promoCode')}
                />
                <input
                  className="field"
                  type="date"
                  value={form.promo_until}
                  onChange={(e) => setForm({ ...form, promo_until: e.target.value })}
                  title="Valable jusqu'au"
                />
              </div>
            </div>

            <button onClick={() => void saveEdits()} className="btn btn-accent w-full" disabled={busy}>
              {busy ? t('common.saving') : t('place.saveEdits')}
            </button>
          </section>
        )}

        {/* Voyage */}
        <section>
          <p className="label">{t('common.trip')}</p>
          {trips.length === 0 ? (
            <p className="text-[13px] text-text-muted">
              Aucun voyage cree pour l'instant.{' '}
              <Link to="/voyages" className="text-accent underline-offset-4 hover:underline">{t('place.createOne')}</Link>
            </p>
          ) : (
            <select
              className="field"
              value={place.trip_id ?? ''}
              disabled={busy}
              onChange={(e) => {
                const value = e.target.value || null
                void edit(place.id, { trip_id: value }).catch((err) =>
                  setError(errorMessage(err)),
                )
              }}
            >
              <option value="">{t('place.standalone')}</option>
              {trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          )}
        </section>

        {/* Budget, avis, bon plan */}
        <section className={editing ? 'hidden' : ''}>
          <PlaceExtras place={place} />
        </section>

        {/* Notes */}
        <section className={editing ? 'hidden' : ''}>
          <p className="label">{t('common.notes')}</p>
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-text-soft">
            {place.notes?.trim() || (
              <span className="text-text-muted">{t('place.noNote')}</span>
            )}
          </p>
        </section>

        {/* Photos */}
        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="label mb-0">
              Photos {photos.length > 0 && <span className="text-text-muted">{photos.length}</span>}
            </p>
            <label className="btn btn-xs cursor-pointer">
              {busy ? t('place.sending') : t('common.add')}
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  void onFiles(e.target.files)
                  e.target.value = ''
                }}
              />
            </label>
          </div>

          {loading ? (
            <p className="text-[13px] text-text-muted">{t('common.loading')}</p>
          ) : photos.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-9 text-center text-[13px] text-text-muted">{t('place.noPhoto')}</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((photo, i) => (
                <div
                  key={photo.id}
                  className="arch-soft group relative aspect-[4/5] border border-line bg-surface-2"
                >
                  {urls[photo.url] ? (
                    <img
                      src={urls[photo.url]}
                      alt=""
                      loading="lazy"
                      onClick={() => setZoom(i)}
                      className="h-full w-full cursor-zoom-in object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="h-full w-full animate-pulse bg-surface-2" />
                  )}
                  <button
                    onClick={() => void onDeletePhoto(photo)}
                    className="absolute right-1.5 top-1.5 hidden h-6 w-6 items-center justify-center rounded-full border border-line bg-bg/85 text-[11px] text-text-soft backdrop-blur group-hover:flex"
                    aria-label={t('place.deletePhoto')}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {error && <p className="notice notice-bad">{error}</p>}
      </div>

      <footer className="border-t border-line px-6 py-4">
        <button
          onClick={() => void onDeletePlace()}
          disabled={busy}
          className={`btn btn-xs w-full ${confirmDelete ? 'border-red-500/60 text-red-400' : 'btn-quiet'}`}
        >
          {confirmDelete ? t('place.deleteConfirm') : t('place.deleteAction')}
        </button>
      </footer>

      {zoom !== null && gallery.length > 0 && (
        <Lightbox
          urls={gallery}
          index={Math.min(zoom, gallery.length - 1)}
          onIndexChange={setZoom}
          onClose={() => setZoom(null)}
          caption={`${place.name}, ${place.country}`}
        />
      )}
    </aside>
  )
}
