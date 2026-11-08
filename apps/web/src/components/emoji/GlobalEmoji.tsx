import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Smile } from 'lucide-react'
import { EmojiPanel } from '@/components/emoji/EmojiPanel'

type Field = HTMLInputElement | HTMLTextAreaElement

const TEXT_TYPES = new Set(['text', 'search', ''])

/** Champ de texte libre éligible : pas de mot de passe, d'e-mail, de nombre, de fichier ; pas en lecture seule. */
function eligible(el: EventTarget | null): el is Field {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled && !el.closest('[data-no-emoji]')
  if (el instanceof HTMLInputElement) return TEXT_TYPES.has(el.type) && !el.readOnly && !el.disabled && !el.closest('[data-no-emoji]') && el.dataset.noEmoji === undefined
  return false
}

/**
 * Emojis dans TOUS les formulaires du site : dès qu'un champ de texte libre prend le focus, un petit bouton 🙂 apparaît à son
 * extrémité ; le choix s'insère à l'endroit du curseur (titres, descriptions, noms, commentaires, recherche…).
 */
export function GlobalEmoji() {
  const [field, setField] = useState<Field | null>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const measure = useCallback((el: Field | null) => setRect(el ? el.getBoundingClientRect() : null), [])

  useEffect(() => {
    const onIn = (e: FocusEvent) => {
      if (!eligible(e.target)) return
      clearTimeout(hideTimer.current)
      setField(e.target)
      measure(e.target)
    }
    const onOut = () => {
      clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(() => {
        const active = document.activeElement
        if (panel.current?.contains(active) || btn.current === active) return
        setOpen(false)
        setField(null)
        setRect(null)
      }, 200)
    }
    document.addEventListener('focusin', onIn)
    document.addEventListener('focusout', onOut)
    return () => {
      document.removeEventListener('focusin', onIn)
      document.removeEventListener('focusout', onOut)
      clearTimeout(hideTimer.current)
    }
  }, [measure])

  // le bouton suit le champ quand la page défile ou change de taille
  useEffect(() => {
    if (!field) return
    const update = () => {
      if (!document.contains(field)) {
        setField(null)
        setRect(null)
        return
      }
      measure(field)
    }
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    const t = setInterval(update, 800)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
      clearInterval(t)
    }
  }, [field, measure])

  const insert = (emoji: string) => {
    if (!field) return
    field.focus()
    const start = field.selectionStart ?? field.value.length
    const end = field.selectionEnd ?? start
    // écriture « native » + évènement input : fonctionne avec les champs React contrôlés et react-hook-form
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')?.set
    setter?.call(field, field.value.slice(0, start) + emoji + field.value.slice(end))
    field.setSelectionRange(start + emoji.length, start + emoji.length)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }

  if (!field || !rect || rect.width < 60 || typeof document === 'undefined') return null
  const multiline = field instanceof HTMLTextAreaElement
  const top = multiline ? rect.bottom - 30 : rect.top + rect.height / 2 - 12
  const left = Math.min(rect.right - 30, window.innerWidth - 32)
  const panelTop = rect.bottom + 8 + 384 > window.innerHeight ? Math.max(8, rect.top - 392) : rect.bottom + 8
  const panelLeft = Math.max(8, Math.min(rect.right - 320, window.innerWidth - 328))

  return createPortal(
    <>
      <button
        ref={btn}
        type="button"
        data-no-emoji
        aria-label="Insérer un emoji"
        title="Insérer un emoji"
        onMouseDown={(e) => e.preventDefault() /* le champ garde le focus et son curseur */}
        onClick={() => setOpen((o) => !o)}
        className="fixed z-[9998] flex size-6 items-center justify-center rounded-full bg-neutral-800/90 text-neutral-200 shadow ring-1 ring-white/15 transition hover:scale-110 hover:text-white"
        style={{ top, left }}
      >
        <Smile className="size-4" />
      </button>
      {open && (
        <div ref={panel} className="fixed z-[9999]" style={{ top: panelTop, left: panelLeft }} onMouseDown={(e) => e.stopPropagation()}>
          <EmojiPanel onPick={insert} />
        </div>
      )}
    </>,
    document.body,
  )
}
