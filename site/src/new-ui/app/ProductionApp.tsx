import { Suspense, lazy } from 'react'
import { FullPageState, PageSkeleton } from '../components/ui/Feedback'
import { AdminProductionPages } from '../pages/production/AdminProductionPages'
import { AdminNavigationProvider } from './AdminNavigationProvider'
import { useExperience } from './ExperienceProvider'
import { useProductionRouter } from './productionRouter'

const loadCustomerPages = () => import('../pages/production/ProductionPages')
const AuthProductionPages = lazy(() => loadCustomerPages().then((module) => ({ default: module.AuthProductionPages })))
const PortalProductionPages = lazy(() => loadCustomerPages().then((module) => ({ default: module.PortalProductionPages })))
const PublicProductionPages = lazy(() => loadCustomerPages().then((module) => ({ default: module.PublicProductionPages })))
const SystemProductionPages = lazy(() => loadCustomerPages().then((module) => ({ default: module.SystemProductionPages })))

export function ProductionApp() {
  const { route, navigate } = useProductionRouter()
  if (route.surface === 'admin') return <AdminNavigationProvider><AdminProductionPages page={route.page} routeState={route.state} navigate={navigate} /></AdminNavigationProvider>
  const content = route.surface === 'auth' ? <AuthProductionPages page={route.page} routeState={route.state} navigate={navigate} />
    : route.surface === 'portal' ? <PortalProductionPages page={route.page} navigate={navigate} />
    : route.surface === 'system' ? <SystemProductionPages page={route.page} navigate={navigate} />
    : <PublicProductionPages page={route.page} routeState={route.state} navigate={navigate} />
  return <Suspense fallback={<PageSkeleton cards={1} />}>{content}</Suspense>
}

export function ProductionRouteError() {
  const { locale, t } = useExperience()
  return <FullPageState title={locale === 'ar' ? 'تعذّر فتح الصفحة' : 'Could not open this page'}
    primaryLabel={t('retry')} onPrimary={() => window.location.reload()} />
}
