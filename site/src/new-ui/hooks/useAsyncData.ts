import { useCallback, useEffect, useState } from 'react'

type ResourceStatus = 'idle' | 'bootstrapping' | 'loading_initial' | 'refreshing' | 'success' | 'empty' | 'partial' | 'error_recoverable' | 'error_terminal'
type AsyncResource<T> = { status: ResourceStatus; loading: boolean; refreshing: boolean; data: T | null; error: string | null; reload: () => void }

function isEmptyAsyncData<T>(data: T | null): boolean {
  if (data == null) return true
  if (Array.isArray(data)) return data.length === 0
  return false
}

export function useAsyncData<T>(load: (signal: AbortSignal) => Promise<T>, deps: React.DependencyList, requestKey?: string): AsyncResource<T> {
  const [version, setVersion] = useState(0)
  const [state, setState] = useState<Omit<AsyncResource<T>, 'reload'> & { key?: string }>({ status: 'idle', loading: true, refreshing: false, data: null, error: null, key: requestKey })
  useEffect(() => {
    const controller = new AbortController()
    Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) return
        setState((previous) => {
          const data = previous.key === requestKey ? previous.data : null
          return { status: data ? 'refreshing' : 'loading_initial', loading: !data, refreshing: Boolean(data), data, error: null, key: requestKey }
        })
        return load(controller.signal)
      })
      .then((data) => {
        if (!controller.signal.aborted && data !== undefined) setState({ status: isEmptyAsyncData(data) ? 'empty' : 'success', loading: false, refreshing: false, data, error: null, key: requestKey })
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState((previous) => ({
          status: previous.data ? 'partial' : 'error_recoverable',
          loading: false,
          refreshing: false,
          data: previous.data,
          error: error instanceof Error ? error.message : 'request_failed',
          key: requestKey,
        }))
      })
    return () => controller.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, requestKey, version])
  const reload = useCallback(() => setVersion((value) => value + 1), [])
  return state.key === requestKey ? { ...state, reload } : { status: 'loading_initial', loading: true, refreshing: false, data: null, error: null, reload }
}
