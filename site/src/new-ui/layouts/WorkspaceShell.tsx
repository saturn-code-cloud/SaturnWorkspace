import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useExperience } from '../app/ExperienceProvider'
import type { AppRoute, Surface } from '../app/routes'
import { AdminSectionFinder } from './AdminSectionFinder'
import { RouteLink } from '../components/ui/RouteLink'
import { IconButton } from '../components/ui/Button'
import { Brand, PublicFooter, PublicHeader, Topbar, type Navigate } from './SharedChrome'

export type NavigationGroup = { label?: string; items: { id: string; label: string; icon: LucideIcon; badge?: string; disabled?: boolean }[] }

function WorkspaceNavigation({ surface, page, groups, navigate, operationalAdmin, compact }: {
  surface: Extract<Surface, 'portal' | 'admin'>; page: string; groups: NavigationGroup[];
  navigate: Navigate; operationalAdmin: boolean; compact: boolean;
}) {
  const { t } = useExperience()
  return <div className="workspace-sidebar__nav">{groups.map((group, index) => <nav key={`${group.label}-${index}`} aria-label={group.label || t('overview')}>
    {group.label && !compact ? <span>{group.label}</span> : null}
    {group.items.map((item) => {
      const Icon = item.icon
      const active = page === item.id
      const route: AppRoute = { surface, page: item.id }
      const itemContent = <><Icon size={17} aria-hidden="true" /><span>{item.label}</span>{item.badge && !compact ? <em>{item.badge}</em> : null}</>
      return operationalAdmin && !item.disabled
        ? <RouteLink key={item.id} className={active ? 'is-active' : ''} aria-current={active ? 'page' : undefined} aria-label={item.label} title={item.label} route={route} navigate={navigate}>{itemContent}</RouteLink>
        : <button type="button" key={item.id} className={active ? 'is-active' : ''} aria-current={active ? 'page' : undefined} aria-label={item.label} disabled={item.disabled} title={compact ? item.label : undefined} onClick={() => navigate(route)}>{itemContent}</button>
    })}
  </nav>)}</div>
}

export function WorkspaceShell({ surface, page, title, groups, navigate, children, admin = false, adminEmail, operationalAdmin = false }: { surface: Extract<Surface, 'portal' | 'admin'>; page: string; title: string; groups: NavigationGroup[]; navigate: Navigate; children: ReactNode; admin?: boolean; adminEmail?: string; operationalAdmin?: boolean }) {
  const { t, locale } = useExperience()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const content = useRef<HTMLElement>(null)
  const desktopMenu = useRef<HTMLElement>(null)
  const mobileMenu = useRef<HTMLDialogElement>(null)
  const closeMobileButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.documentElement.dataset.surface
    document.documentElement.dataset.surface = admin ? 'admin' : surface
    return () => {
      if (previous) document.documentElement.dataset.surface = previous
      else delete document.documentElement.dataset.surface
    }
  }, [admin, surface])
  useEffect(() => {
    const dialog = mobileMenu.current
    if (!operationalAdmin || !mobileOpen || !dialog) return
    const narrow = window.matchMedia('(max-width: 767px)')
    if (!narrow.matches) return
    dialog.showModal()
    closeMobileButton.current?.focus({ preventScroll: true })
    const close = () => {
      if (dialog.open) dialog.close()
      setMobileOpen(false)
    }
    const resize = () => {
      if (narrow.matches) return
      close()
      const target = desktopMenu.current?.querySelector<HTMLElement>('[aria-current="page"]') ?? content.current
      target?.focus({ preventScroll: true })
    }
    narrow.addEventListener('change', resize)
    window.addEventListener('popstate', close)
    return () => {
      if (dialog.open) dialog.close()
      narrow.removeEventListener('change', resize)
      window.removeEventListener('popstate', close)
    }
  }, [operationalAdmin, mobileOpen])
  const brandRoute: AppRoute = admin ? { surface: 'admin', page: 'overview' } : { surface: 'public', page: 'home' }
  const goTo: Navigate = (route) => {
    if (mobileMenu.current?.open) {
      mobileMenu.current.close()
      if (route.page !== page) content.current?.focus({ preventScroll: true })
    }
    setMobileOpen(false)
    navigate(route)
  }
  const mainId = operationalAdmin ? 'admin-workspace-content' : undefined
  const navId = operationalAdmin ? 'admin-workspace-nav' : undefined
  const navigation = { surface, page, groups, navigate: goTo, operationalAdmin }
  return <div className={`workspace-shell${operationalAdmin ? ' workspace-shell--operational' : ''}${collapsed ? ' is-collapsed' : ''}${mobileOpen ? ' is-mobile-open' : ''}`}>
    {operationalAdmin ? <a className="admin-skip-link" href={`#${mainId}`} onClick={(event) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !content.current) return
      event.preventDefault()
      content.current.focus()
    }}>{locale === 'ar' ? 'انتقل إلى المحتوى' : 'Skip to content'}</a> : null}
    <aside ref={desktopMenu} className="workspace-sidebar">
      <Brand compact={collapsed} onClick={() => goTo(brandRoute)} />
      <WorkspaceNavigation {...navigation} compact={collapsed} />
      <button type="button" className="workspace-sidebar__collapse" aria-label={collapsed ? t('expand') : t('collapse')} onClick={() => setCollapsed((value) => !value)}>
        {locale === 'ar' ? (collapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />) : (collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />)}
        <span>{collapsed ? t('expand') : t('collapse')}</span>
      </button>
    </aside>
    {operationalAdmin ? <dialog ref={mobileMenu} id={navId} aria-label={t('menu')} className="admin-mobile-navigation"
      onClose={() => setMobileOpen(false)}
      onCancel={(event) => { event.preventDefault(); event.currentTarget.close() }}
      onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close() }}>
      <div className="admin-mobile-navigation__panel">
        <header>
          <Brand onClick={() => goTo(brandRoute)} />
          <IconButton ref={closeMobileButton} type="button" label={t('close')} onClick={() => mobileMenu.current?.close()}><X size={18} aria-hidden="true" /></IconButton>
        </header>
        {mobileOpen ? <WorkspaceNavigation {...navigation} compact={false} /> : null}
      </div>
    </dialog> : null}
    <div className="workspace-main">
      <Topbar title={title} admin={admin} adminEmail={adminEmail} navigate={navigate} onOpenMenu={() => setMobileOpen((value) => !value)}
        menuExpanded={operationalAdmin ? mobileOpen : undefined} menuControls={navId}
        sectionFinder={operationalAdmin ? <AdminSectionFinder groups={groups} navigate={goTo} /> : undefined} />
      <main ref={content} className="workspace-content page-enter" id={mainId} tabIndex={operationalAdmin ? -1 : undefined}>{children}</main>
    </div>
    {mobileOpen && !operationalAdmin ? <button type="button" aria-label={t('close')} className="workspace-scrim" onClick={() => setMobileOpen(false)} /> : null}
  </div>
}

export function PublicLayout({ navigate, children }: { navigate: Navigate; children: ReactNode }) {
  return <div className="public-shell"><PublicHeader navigate={navigate} /><main>{children}</main><PublicFooter navigate={navigate} /></div>
}
