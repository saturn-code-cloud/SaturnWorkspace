import { Suspense, lazy, useMemo } from 'react'
import { Bug, CheckCheck, Database, CreditCard, LayoutDashboard, LifeBuoy, Mail, Monitor, PackageOpen, ScrollText, Settings, ShieldCheck, Tags, Users, WalletCards } from 'lucide-react'
import { AdminAccessGate } from './AdminAccessGate'
import { useExperience } from '../../app/ExperienceProvider'
import { PageHeader } from '../../components/ui/DataDisplay'
import { RouteLink } from '../../components/ui/RouteLink'
import { Alert } from '../../components/ui/Feedback'
import { WorkspaceShell, type NavigationGroup } from '../../layouts/WorkspaceShell'
import type { Navigate } from '../../app/routes'
import { canOpenAdminSection, hasAdminPermission } from './adminAccess'
import { copyByLocale } from './productionPresentation'
import { AdminSectionBoundary, AdminSectionLoadError, AdminSectionLoading } from './AdminSectionBoundary'

const AdminAudit = lazy(() => import('./AdminGovernanceWorkspace').then((module) => ({ default: module.AdminAudit })))
const AdminData = lazy(() => import('./AdminDataWorkspace').then((module) => ({ default: module.AdminData })))
const AdminDeviceRequests = lazy(() => import('./AdminDeviceWorkspace').then((module) => ({ default: module.AdminDeviceRequests })))
const AdminDiagnostics = lazy(() => import('./AdminDiagnosticWorkspace').then((module) => ({ default: module.AdminDiagnostics })))
const AdminOverview = lazy(() => import('./AdminOverviewWorkspace').then((module) => ({ default: module.AdminOverview })))
const AdminPolicies = lazy(() => import('./AdminGovernanceWorkspace').then((module) => ({ default: module.AdminPolicies })))
const AdminReadiness = lazy(() => import('./AdminGovernanceWorkspace').then((module) => ({ default: module.AdminReadiness })))
const AdminSubscriptions = lazy(() => import('./AdminAccountWorkspace').then((module) => ({ default: module.AdminSubscriptions })))
const AdminUsers = lazy(() => import('./AdminAccountWorkspace').then((module) => ({ default: module.AdminUsers })))
const AdminCommerce = lazy(() => import('./AdminCommerce').then((module) => ({ default: module.AdminCommerce })))
const AdminEmailWorkspace = lazy(() => import('./AdminEmailWorkspace').then((module) => ({ default: module.AdminEmailWorkspace })))
const AdminPromotions = lazy(() => import('./AdminPromotions').then((module) => ({ default: module.AdminPromotions })))
const AdminSettings = lazy(() => import('./AdminSettings').then((module) => ({ default: module.AdminSettings })))
const AdminReleases = lazy(() => import('./AdminReleaseWorkspace').then((module) => ({ default: module.AdminReleases })))
const AdminSupportV2 = lazy(() => import('./AdminSupportWorkspace').then((module) => ({ default: module.AdminSupportV2 })))

export function AdminProductionPages({ page, routeState, navigate }: { page: string; routeState?: string; navigate: Navigate }) {
  const { t, locale } = useExperience()
  const groups = useMemo<NavigationGroup[]>(() => [
    { items: [{ id: 'overview', label: t('overview'), icon: LayoutDashboard }] },
    { label: t('operations'), items: [{ id: 'support', label: t('supportInbox'), icon: LifeBuoy }, { id: 'device-requests', label: copyByLocale(locale, 'Device requests', 'طلبات تغيير الجهاز'), icon: Monitor }, { id: 'diagnostics', label: t('diagnostics'), icon: Bug }, { id: 'data', label: copyByLocale(locale, 'Data', 'البيانات'), icon: Database }, { id: 'communications', label: copyByLocale(locale, 'Email operations', 'عمليات البريد'), icon: Mail }] },
    { label: copyByLocale(locale, 'Accounts', 'الحسابات'), items: [{ id: 'users', label: t('users'), icon: Users }, { id: 'subscriptions', label: t('subscriptions'), icon: CreditCard }, { id: 'commerce', label: t('payments'), icon: WalletCards }] },
    { label: t('distribution'), items: [{ id: 'releases', label: t('releases'), icon: PackageOpen }, { id: 'promos', label: t('promoCodes'), icon: Tags }] },
    { label: t('governance'), items: [{ id: 'policies', label: t('policies'), icon: ShieldCheck }, { id: 'audit', label: t('auditLog'), icon: ScrollText }, { id: 'readiness', label: copyByLocale(locale, 'Readiness', 'الجاهزية'), icon: CheckCheck }, { id: 'settings', label: t('settings'), icon: Settings }] },
  ], [t, locale])
  const title = groups.flatMap((group) => group.items).find((item) => item.id === page)?.label || t('adminOverview')
  return <AdminAccessGate>{(session) => {
    const permissions = session.permissions || []
    const permitted = (permission: string) => hasAdminPermission(permissions, permission)
    const canReadUsers = permitted('users:read')
    const canReadDiagnostics = permitted('diagnostics:read')
    const canReadAudit = permitted('audit:read')
    const visibleGroups = groups.map((group) => ({ ...group, items: group.items.filter((item) => canOpenAdminSection(permissions, item.id)) })).filter((group) => group.items.length > 0)
    const knownSection = groups.some((group) => group.items.some((item) => item.id === page))
    return <WorkspaceShell surface="admin" page={page} title={title} groups={visibleGroups} navigate={navigate} admin adminEmail={session.email} operationalAdmin>
      <AdminSectionBoundary key={page} fallback={<AdminSectionLoadError />}>
        <Suspense fallback={<AdminSectionLoading />}>
      {!knownSection ? <><PageHeader title={copyByLocale(locale, 'Section unavailable', 'القسم غير متاح')} /><RouteLink route={{ surface: 'admin', page: 'overview' }} navigate={navigate}>{t('overview')}</RouteLink></>
      : !canOpenAdminSection(permissions, page) ? <><PageHeader title={title} /><Alert tone="warning" title={copyByLocale(locale, 'You do not have permission to open this section.', 'ليس لديك صلاحية لفتح هذا القسم.')} /><RouteLink route={{ surface: 'admin', page: 'overview' }} navigate={navigate}>{t('overview')}</RouteLink></>
      : page === 'device-requests' ? <AdminDeviceRequests routeState={routeState} navigate={navigate} canDecide={permitted('users:write')} />
      : page === 'diagnostics' ? <AdminDiagnostics routeState={routeState} navigate={navigate} canDecide={permitted('diagnostics:write')} />
      : page === 'data' ? <AdminData routeState={routeState} navigate={navigate} />
      : page === 'audit' ? <AdminAudit routeState={routeState} navigate={navigate} canReadDeviceRequests={canReadUsers} />
      : page === 'users' ? <AdminUsers routeState={routeState} navigate={navigate} canReadAudit={canReadAudit} canReadDiagnostics={canReadDiagnostics} canResolveAlerts={permitted('diagnostics:write')} canManageAccounts={permitted('users:write')} canEndAccess={permitted('sessions:revoke')} canReadSubscriptions={permitted('subscriptions:read')} canManageSubscriptions={permitted('subscriptions:write')} />
      : page === 'subscriptions' ? <AdminSubscriptions routeState={routeState} navigate={navigate} canManage={permitted('subscriptions:write')} />
      : page === 'releases' ? <AdminReleases routeState={routeState} navigate={navigate} canManage={permitted('releases:write')} />
      : page === 'support' ? <AdminSupportV2 routeState={routeState} navigate={navigate} canManage={permitted('support:write')} />
      : page === 'communications' ? <AdminEmailWorkspace canManage={permitted('communications:write')} routeState={routeState} navigate={navigate} />
      : page === 'promos' ? <AdminPromotions canManage={permitted('promotions:write')} routeState={routeState} navigate={navigate} />
      : page === 'commerce' ? <AdminCommerce routeState={routeState} navigate={navigate} canReadSubscriptions={permitted('subscriptions:read')} />
      : page === 'policies' ? <AdminPolicies canManage={permitted('policies:write')} owner={session.email} routeState={routeState} navigate={navigate} />
      : page === 'readiness' ? <AdminReadiness />
      : page === 'settings' ? <AdminSettings session={session} />
      : <AdminOverview navigate={navigate} canReadDeviceRequests={canReadUsers} canReadDiagnostics={canReadDiagnostics} canReadAudit={canReadAudit} />}
        </Suspense>
      </AdminSectionBoundary>
    </WorkspaceShell>
  }}</AdminAccessGate>
}
