import { createContext, useContext, useLayoutEffect, useState } from 'react'
import type { AppRoute } from './routes'

export type ProtectionMode = 'draft' | 'saving' | 'invite-code'
export type NavigationProtection = {
  page: string
  mode: ProtectionMode
  retainOn?: (route: AppRoute) => boolean
}

export const AdminNavigationContext = createContext<{
  register: (key: symbol, entry: NavigationProtection) => () => void
  requestExit: (run: () => void, key?: symbol) => void
} | null>(null)

export function protectionForDestination(entries: Iterable<NavigationProtection>, destination?: AppRoute): ProtectionMode | null {
  let mode: ProtectionMode | null = null
  for (const entry of entries) {
    if (destination?.surface === 'admin' && destination.page === entry.page && (!entry.retainOn || entry.retainOn(destination))) continue
    if (entry.mode === 'saving') return 'saving'
    if (mode !== 'invite-code') mode = entry.mode
  }
  return mode
}

export function useAdminNavigationProtection(page: string, mode: ProtectionMode | null, retainOn?: NavigationProtection['retainOn']) {
  const context = useContext(AdminNavigationContext)
  const [key] = useState(() => Symbol())
  useLayoutEffect(() => {
    if (context && mode) return context.register(key, { page, mode, retainOn })
  }, [context, key, page, mode, retainOn])
  return (run: () => void) => context ? context.requestExit(run, key) : run()
}

export function useAdminExitAction() {
  const context = useContext(AdminNavigationContext)
  return (run: () => void) => context ? context.requestExit(run) : run()
}
