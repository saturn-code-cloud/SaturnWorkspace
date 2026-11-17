import { useCallback, useLayoutEffect, useMemo } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router'
import { activationFromQuery, rememberActivationPayload } from './desktopActivation'
import type { AppRoute, Navigate } from './routes'

const PUBLIC_PAGES = new Set(['product', 'features', 'pricing', 'compare', 'download', 'releases', 'changelog', 'faq', 'contact', 'support', 'privacy', 'terms', 'refund', 'acceptable-use', 'cookies'])
const PORTAL_PAGES = new Set(['overview', 'subscription', 'payments', 'downloads', 'devices', 'notifications', 'support', 'security', 'settings'])
const ADMIN_PAGES = new Set(['overview', 'users', 'device-requests', 'subscriptions', 'commerce', 'releases', 'promos', 'support', 'communications', 'diagnostics', 'data', 'policies', 'audit', 'content', 'settings', 'coverage', 'readiness'])

function adminRoute(page: string, state?: string): AppRoute {
  if (page === 'users' && new URLSearchParams(state).has('request')) page = 'device-requests'
  return { surface: 'admin', page: ADMIN_PAGES.has(page) ? page : 'overview', state }
}

function normalizePath(pathname: string) {
  if (!pathname || pathname === '/') return '/'
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

function isAdminHost() {
  return typeof window !== 'undefined' && window.location.hostname.toLowerCase().startsWith('admin.')
}

export function routeToPath(route: AppRoute): string {
  let path: string
  if (route.surface === 'auth') path = route.page === 'signup' ? '/account/signup' : route.page === 'verify' ? '/account/verify' : route.page === 'linked' ? '/account/linked' : '/account/signin'
  else if (route.surface === 'portal') path = route.page === 'overview' ? '/account' : `/account/${route.page}`
  else if (route.surface === 'admin') path = isAdminHost() ? (route.page === 'overview' ? '/' : `/${route.page}`) : (route.page === 'overview' ? '/admin' : `/admin/${route.page}`)
  else if (route.surface === 'system') path = `/${route.page}`
  else if (route.page === 'home') path = '/'
  else path = `/${route.page}`
  return `${path}${route.state?.startsWith('?') ? route.state : ''}`
}

export function routeFromInternalUrl(value: string): AppRoute {
  const url = new URL(value, window.location.origin)
  if (url.origin !== window.location.origin) return { surface: 'public', page: 'home' }
  const host = url.hostname.toLowerCase()
  const path = normalizePath(url.pathname)
  const state = url.search || undefined
  if (host.startsWith('admin.')) {
    const page = path === '/' || path === '/admin' ? 'overview' : path.replace(/^\/admin\/?/, '').replace(/^\//, '') || 'overview'
    return adminRoute(page, state)
  }
  if (path === '/login' || path === '/account/signin' || path === '/activate') return { surface: 'auth', page: 'signin', state }
  if (path === '/account/signup') return { surface: 'auth', page: 'signup', state }
  if (path === '/account/verify') return { surface: 'auth', page: 'verify', state }
  if (path === '/account/linked') return { surface: 'auth', page: 'linked', state }
  if (path === '/account') return { surface: 'portal', page: 'overview', state }
  if (path.startsWith('/account/')) {
    const page = path.replace('/account/', '')
    return { surface: 'portal', page: PORTAL_PAGES.has(page) ? page : 'overview', state }
  }
  if (path === '/admin') return { surface: 'admin', page: 'overview', state }
  if (path.startsWith('/admin/')) {
    const page = path.replace('/admin/', '')
    return adminRoute(page, state)
  }
  if (path === '/downloads') return { surface: 'public', page: 'download', state }
  if (path === '/release-notes') return { surface: 'public', page: 'releases', state }
  if (['/403', '/404', '/429', '/500', '/503'].includes(path)) return { surface: 'system', page: path.slice(1), state }
  if (path === '/') return { surface: 'public', page: 'home', state }
  const page = path.slice(1)
  return { surface: 'public', page: PUBLIC_PAGES.has(page) ? page : '404', state }
}

export function prepareProductionEntry() {
  const { pathname, search, hash, href } = window.location
  const path = normalizePath(pathname)
  const route = routeFromInternalUrl(href)
  let cleanPath: string | undefined
  if (route.surface === 'auth' && path === '/activate') {
    const activation = activationFromQuery(search)
    if (activation && rememberActivationPayload(activation)) {
      const params = new URLSearchParams(search)
      for (const name of ['ticket', 'device_code', 'code']) params.delete(name)
      cleanPath = `/account/signin${params.size ? '?' + params : ''}`
    }
  } else if (
    (isAdminHost() && (path === '/admin' || path.startsWith('/admin/'))) ||
    (route.surface === 'admin' && route.page === 'device-requests' && path.endsWith('/users'))
  ) {
    cleanPath = routeToPath(route)
  }
  // Normalize incoming links before the data router starts managing history.
  if (cleanPath && cleanPath !== pathname + search) {
    window.history.replaceState(window.history.state, '', cleanPath + hash)
  }
}

export function useProductionRouter() {
  const { pathname, search, state, key } = useLocation()
  const action = useNavigationType()
  const routerNavigate = useNavigate()
  const route = useMemo(() => routeFromInternalUrl(pathname + search), [pathname, search])
  useLayoutEffect(() => {
    if (action !== 'POP' && !state?.preserveScroll) {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'instant' : 'smooth' })
    }
  }, [action, key, state])
  const navigate: Navigate = useCallback((next, options) => {
    void routerNavigate(routeToPath(next), {
      replace: options?.replace ?? false,
      state: { preserveScroll: options?.preserveScroll ?? false },
    })
  }, [routerNavigate])
  return { route, navigate }
}
