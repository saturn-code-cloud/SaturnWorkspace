import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button, IconButton } from './Button'

function useEscape(open: boolean, onClose: () => void, dialogRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]')
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing &&
          dialogs[dialogs.length - 1] === dialogRef.current) {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose, dialogRef])
}

const openDialogs = new Set<HTMLElement>()
let overflowBeforeDialogs = ''

function useOverlayLifecycle(open: boolean, dialogRef: RefObject<HTMLElement | null>, initialFocusRef?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const dialog = dialogRef.current
    if (!open || !dialog) return
    const previousFocus = document.activeElement as HTMLElement | null
    if (!openDialogs.size) {
      overflowBeforeDialogs = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    openDialogs.add(dialog)
    const firstControl = (root: HTMLElement) => root.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')
    const frame = window.requestAnimationFrame(() => {
      if (Array.from(openDialogs).at(-1) === dialog) (initialFocusRef?.current ?? firstControl(dialog))?.focus({ preventScroll: true })
    })
    return () => {
      window.cancelAnimationFrame(frame)
      const wasTop = Array.from(openDialogs).at(-1) === dialog
      openDialogs.delete(dialog)
      if (!openDialogs.size) document.body.style.overflow = overflowBeforeDialogs
      if (!wasTop) return
      const next = Array.from(openDialogs).at(-1)
      if (previousFocus?.isConnected && (!next || next.contains(previousFocus))) previousFocus.focus({ preventScroll: true })
      else if (next?.isConnected) firstControl(next)?.focus({ preventScroll: true })
    }
  }, [open, dialogRef, initialFocusRef])
}

function trapDialogFocus(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href]:not([tabindex="-1"]), button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
  if (!focusable.length) {
    event.preventDefault()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!focusable.includes(document.activeElement as HTMLElement)) {
    event.preventDefault()
    const next = event.shiftKey ? last : first
    next.focus()
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

export function Modal({ open, onClose, title, description, closeLabel, closeDisabled = false, children, footer, size = 'md', initialFocusRef }: { open: boolean; onClose: () => void; title: string; description?: string; closeLabel: string; closeDisabled?: boolean; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg'; initialFocusRef?: RefObject<HTMLElement | null> }) {
  const dialogRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  useEscape(open && !closeDisabled, onClose, dialogRef)
  useOverlayLifecycle(open, dialogRef, initialFocusRef)
  useEffect(() => {
    if (open && closeDisabled) dialogRef.current?.focus()
  }, [open, closeDisabled])
  if (!open) return null
  return createPortal(<div className="ui-overlay" role="presentation" onMouseDown={(event) => { if (!closeDisabled && event.target === event.currentTarget) onClose() }}><section ref={dialogRef} className={`ui-modal ui-modal--${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={closeDisabled ? -1 : undefined} onKeyDown={trapDialogFocus}><header><div><h2 id={titleId}>{title}</h2>{description ? <p>{description}</p> : null}</div><IconButton label={closeLabel} onClick={onClose} disabled={closeDisabled}><X size={18} /></IconButton></header><div className="ui-modal__body">{children}</div>{footer ? <footer>{footer}</footer> : null}</section></div>, document.body)
}

export function Drawer({ open, onClose, title, description, closeLabel, closeDisabled = false, children, footer, className = '' }: { open: boolean; onClose: () => void; title: string; description?: string; closeLabel: string; closeDisabled?: boolean; children: ReactNode; footer?: ReactNode; className?: string }) {
  const dialogRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  useEscape(open && !closeDisabled, onClose, dialogRef)
  useOverlayLifecycle(open, dialogRef)
  useEffect(() => {
    if (open && closeDisabled) dialogRef.current?.focus({ preventScroll: true })
  }, [open, closeDisabled])
  if (!open) return null
  return createPortal(<div className="ui-overlay ui-overlay--drawer" role="presentation" onMouseDown={(event) => { if (!closeDisabled && event.target === event.currentTarget) onClose() }}><aside ref={dialogRef} className={`ui-drawer ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? titleId + '-description' : undefined} tabIndex={closeDisabled ? -1 : undefined} onKeyDown={trapDialogFocus}><header><div><h2 id={titleId}>{title}</h2>{description ? <p id={titleId + '-description'}>{description}</p> : null}</div><IconButton label={closeLabel} onClick={onClose} disabled={closeDisabled}><X size={18} /></IconButton></header><div className="ui-drawer__body">{children}</div>{footer ? <footer>{footer}</footer> : null}</aside></div>, document.body)
}

export function ConfirmDialog({ open, onClose, title, body, confirmLabel, cancelLabel, onConfirm, destructive }: { open: boolean; onClose: () => void; title: string; body: string; confirmLabel: string; cancelLabel: string; onConfirm: () => void; destructive?: boolean }) {
  return <Modal open={open} onClose={onClose} title={title} closeLabel={cancelLabel} size="sm" footer={<><Button onClick={onClose}>{cancelLabel}</Button><Button variant={destructive ? 'danger' : 'primary'} onClick={() => { onConfirm(); onClose() }}>{confirmLabel}</Button></>}><p className="secondary">{body}</p></Modal>
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return <span className="ui-tooltip" data-tooltip={label}>{children}</span>
}

export function Dropdown({ label, trigger, children }: { label: string; trigger: ReactNode; children: ReactNode }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const openMenu = () => {
    document.dispatchEvent(new CustomEvent('saturnws:dropdown-open', { detail: id }))
    setOpen(true)
  }
  const closeMenu = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus())
  }
  useEffect(() => {
    const onOtherOpen = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) setOpen(false)
    }
    document.addEventListener('saturnws:dropdown-open', onOtherOpen)
    return () => document.removeEventListener('saturnws:dropdown-open', onOtherOpen)
  }, [id])
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu(true)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus())
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])
  const navigateMenu = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'))
    if (!items.length) return
    event.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (current + 1) % items.length : (current <= 0 ? items.length - 1 : current - 1)
    items[next]?.focus()
  }
  return <div ref={rootRef} className="ui-dropdown"><button ref={triggerRef} type="button" className="ui-dropdown__trigger" aria-label={label} aria-haspopup="menu" aria-expanded={open} onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openMenu() } }} onClick={() => open ? closeMenu() : openMenu()}>{trigger}</button>{open ? <div className="ui-popover ui-dropdown__menu" role="menu" onKeyDown={navigateMenu} onClick={() => { triggerRef.current?.focus({ preventScroll: true }); closeMenu() }}>{children}</div> : null}</div>
}

export function DropdownItem({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return <button type="button" role="menuitem" tabIndex={-1} onClick={onClick}>{children}</button>
}
