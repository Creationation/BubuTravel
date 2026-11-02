import { useT } from '../i18n/I18nContext'
import { PencilIcon } from './hub/icons'

/**
 * Bouton « modifier » : un crayon, sans texte. Le libelle reste lu par les
 * lecteurs d'ecran et au survol.
 */
export default function EditButton({
  onClick,
  label,
  className = '',
  size = 16,
}: {
  onClick: () => void
  label?: string
  className?: string
  size?: number
}) {
  const t = useT()
  const text = label ?? t('common.edit')
  return (
    <button type="button" onClick={onClick} aria-label={text} title={text} className={`btn btn-icon btn-quiet shrink-0 ${className}`}>
      <PencilIcon size={size} />
    </button>
  )
}
