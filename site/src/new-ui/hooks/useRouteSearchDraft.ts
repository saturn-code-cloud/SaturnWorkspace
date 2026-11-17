import { useEffect, useEffectEvent, useState } from 'react'

export function useRouteSearchDraft(applied: string, context: string, onApply?: (value: string) => void) {
  const [draft, setDraft] = useState({ context, value: applied })
  if (draft.context !== context) setDraft({ context, value: applied })
  const value = draft.context === context ? draft.value : applied
  const pending = value.trim() !== applied
  const automatic = Boolean(onApply)
  const commit = useEffectEvent((next: string, origin: string) => {
    if (origin === context) onApply?.(next)
  })
  useEffect(() => {
    if (!automatic || !pending) return
    const timeout = window.setTimeout(() => commit(value.trim(), context), 250)
    return () => window.clearTimeout(timeout)
  }, [automatic, pending, value, context])
  return { value, pending, setValue: (next: string) => setDraft({ context, value: next }) }
}
