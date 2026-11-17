import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useBlocker, type BlockerFunction } from 'react-router'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Overlays'
import { AdminNavigationContext, protectionForDestination, type NavigationProtection } from './adminNavigationProtection'
import { useExperience } from './ExperienceProvider'
import { routeFromInternalUrl } from './productionRouter'

type ExitAction = { id: symbol; key?: symbol; run: () => void }
type Registry = ReadonlyMap<symbol, NavigationProtection>

function actionMode(entries: Registry, key?: symbol) {
  return key ? entries.get(key)?.mode ?? null : protectionForDestination(entries.values())
}

export function AdminNavigationProvider({ children }: { children: ReactNode }) {
  const registry = useRef(new Map<symbol, NavigationProtection>())
  const [entries, setEntries] = useState<Registry>(() => new Map())
  const [action, setAction] = useState<ExitAction | null>(null)
  const register = useCallback((key: symbol, entry: NavigationProtection) => {
    registry.current.set(key, entry)
    setEntries(new Map(registry.current))
    return () => {
      if (registry.current.get(key) !== entry) return
      registry.current.delete(key)
      setEntries(new Map(registry.current))
    }
  }, [])
  const requestExit = useCallback((run: () => void, key?: symbol) => {
    if (actionMode(registry.current, key)) setAction({ id: Symbol(), key, run })
    else run()
  }, [])
  const clearAction = useCallback((intent: ExitAction) => {
    setAction((previous) => previous === intent ? null : previous)
  }, [])
  const context = useMemo(() => ({ register, requestExit }), [register, requestExit])
  return <AdminNavigationContext.Provider value={context}>
    {children}
    <NavigationPrompt entries={entries} action={action} clearAction={clearAction} />
  </AdminNavigationContext.Provider>
}

function NavigationPrompt({ entries, action, clearAction }: { entries: Registry; action: ExitAction | null; clearAction: (intent: ExitAction) => void }) {
  const { locale } = useExperience()
  const ar = locale === 'ar'
  const shouldBlock: BlockerFunction = useCallback(({ currentLocation, nextLocation }) => {
    if (currentLocation.pathname === nextLocation.pathname && currentLocation.search === nextLocation.search) return false
    return Boolean(protectionForDestination(entries.values(), routeFromInternalUrl(nextLocation.pathname + nextLocation.search)))
  }, [entries])
  const blocker = useBlocker(shouldBlock)
  const actionProtection = action && actionMode(entries, action.key)
  const routeProtection = blocker.state === 'blocked'
    ? protectionForDestination(entries.values(), routeFromInternalUrl(blocker.location.pathname + blocker.location.search))
    : null
  const mode = blocker.state === 'blocked' ? routeProtection : blocker.state === 'unblocked' ? actionProtection : null
  const hasProtection = entries.size > 0
  useEffect(() => {
    if (!hasProtection) return
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = true
    }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [hasProtection])
  useEffect(() => {
    if (blocker.state === 'blocked' && !routeProtection) blocker.reset()
    if (action && (!actionProtection || blocker.state !== 'unblocked')) clearAction(action)
  }, [action, actionProtection, blocker, clearAction, routeProtection])

  const stayRef = useRef<HTMLButtonElement>(null)
  const handledRoute = useRef<typeof blocker | null>(null)
  const handledAction = useRef<symbol | null>(null)
  const choose = (leave: boolean) => {
    if (leave && (!mode || mode === 'saving')) return
    if (blocker.state === 'blocked') {
      if (handledRoute.current === blocker) return
      handledRoute.current = blocker
      if (action) clearAction(action)
      if (leave) blocker.proceed()
      else blocker.reset()
    } else if (blocker.state === 'unblocked' && action && handledAction.current !== action.id) {
      handledAction.current = action.id
      clearAction(action)
      if (leave) action.run()
    }
  }

  const local = blocker.state === 'unblocked' && Boolean(action?.key)
  const title = mode === 'saving'
    ? ar ? 'انتظر اكتمال العملية' : 'Wait for the operation to finish'
    : mode === 'invite-code'
      ? ar ? 'المتابعة دون نسخ الكود؟' : 'Leave without copying the code?'
      : local ? ar ? 'تتجاهل التعديلات؟' : 'Discard changes?' : ar ? 'تغادر بدون حفظ؟' : 'Leave without saving?'
  const leaveLabel = mode === 'invite-code'
    ? ar ? 'المتابعة بدون نسخ' : 'Continue without copying'
    : local ? ar ? 'تجاهل التعديلات' : 'Discard changes' : ar ? 'المغادرة بدون حفظ' : 'Leave without saving'
  return <Modal open={Boolean(mode)} onClose={() => choose(false)} size="sm"
    title={title}
    closeLabel={ar ? 'إغلاق' : 'Close'} initialFocusRef={stayRef}
    footer={<><Button type="button" ref={stayRef} onClick={() => choose(false)}>{ar ? 'البقاء هنا' : 'Stay here'}</Button>
      {mode && mode !== 'saving' ? <Button type="button" variant="danger" onClick={() => choose(true)}>{leaveLabel}</Button> : null}</>}>
    <p>{mode === 'saving'
      ? ar ? 'انتظر نتيجة العملية قبل المتابعة.' : 'Wait for the result before continuing.'
      : mode === 'invite-code'
        ? ar ? 'يظهر هذا الكود مرة واحدة. لن تتمكن من عرضه بعد الإغلاق.' : 'This code is shown once. You cannot view it again after closing.'
        : ar ? 'ستفقد تعديلاتك غير المحفوظة إذا تابعت.' : 'Your unsaved changes will be lost if you continue.'}</p>
  </Modal>
}
