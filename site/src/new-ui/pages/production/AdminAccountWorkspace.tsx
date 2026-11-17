import { lazy, Suspense, type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { CalendarDays, CreditCard, Pause, Play, RefreshCcw, UserRound } from "lucide-react";
import type { AdminDeviceResetPreview, AdminOperationPreview, AdminOperationReason, AdminSubscription, AdminUserDetail, AdminUserDirectoryItem, ManualGrantPreview, ManualGrantPreviewInput, PendingSubscriptionGrant } from "../../../api/admin";
import { useAdapters } from "../../adapters/AdapterProvider";
import { useExperience } from "../../app/ExperienceProvider";
import { useAdminNavigationProtection, type ProtectionMode } from "../../app/adminNavigationProtection";
import type { AppRoute, Navigate } from "../../app/routes";
import { Button } from "../../components/ui/Button";
import { PageHeader, Pagination, SectionHeader, TableToolbar, type Column } from "../../components/ui/DataDisplay";
import { AdminDataTable } from './AdminDataTable';
import { Alert, Badge, EmptyState, SkeletonStack } from "../../components/ui/Feedback";
import { FormField, Input, Select, Textarea } from "../../components/ui/FormControls";
import { Accordion, Tabs } from "../../components/ui/Navigation";
import { Modal } from "../../components/ui/Overlays";
import { RouteLink } from "../../components/ui/RouteLink";
import { adminMutationError, auditActionLabel, copy, date, deviceRequestStatusLabel, deviceRequestTone, statusLabel, tone, useResource } from "./adminPageSupport";
import { supportStatusLabel, supportStatusTone } from "./productionSupport";
import { AdminSectionBoundary, AdminSectionLoadError, AdminSectionLoading } from "./AdminSectionBoundary";
import { useAsyncData } from "../../hooks/useAsyncData";
import { useRouteSearchDraft } from "../../hooks/useRouteSearchDraft";
import { currentAccountSubscription, isCurrentSubscriptionRecord, subscriptionActions, subscriptionDisplayLifecycle, subscriptionSourceLabel, type SubscriptionAction } from "./adminSubscriptionPresentation";
import { deviceRequestsRoute, readUserDirectoryState, userDirectoryRoute, readSubscriptionDirectoryState, subscriptionDirectoryRoute, SUBSCRIPTION_LIFECYCLES, USER_ACCOUNT_STATES, USER_SUBSCRIPTION_STATES, type UserDirectoryState, type SubscriptionDirectoryState } from "./adminRouteState";
import { AdminRecordPage, AdminTaskPage } from "./AdminRecordPage";
import { AdminRecordPreview, AdminRecordPreviewLayout } from "./AdminRecordPreview";
import { useRecordReturnFocus } from "./useRecordReturnFocus";
import { useRecordPreview } from "./useRecordPreview";

type ReviewedManualGrant = { input: ManualGrantPreviewInput; preview: ManualGrantPreview };

const DiagnosticReportHistory = lazy(() => import("./AdminDiagnosticWorkspace").then((module) => ({ default: module.DiagnosticReportHistory })));
const TamperAlertsPanel = lazy(() => import("./AdminDiagnosticWorkspace").then((module) => ({ default: module.TamperAlertsPanel })));

function AccountDiagnosticContent({ children }: { children: ReactNode }) {
  return <AdminSectionBoundary fallback={<AdminSectionLoadError />}>
    <Suspense fallback={<AdminSectionLoading><SkeletonStack rows={3} /></AdminSectionLoading>}>{children}</Suspense>
  </AdminSectionBoundary>;
}

type AccountAction = "suspend" | "reactivate" | "mark_pending_deletion";

type OperationIntent =
  | { kind: "account"; uid: string; action: AccountAction }
  | { kind: "device-unlink"; uid: string; bindingId: string; deviceLabel: string }
  | {
      kind: "access";
      uid: string;
      scope: "session" | "device" | "all";
      targetId?: string;
    }
  | {
      kind: "subscription";
      subscriptionId: string;
      action: SubscriptionAction;
    };

function operationIntentKey(intent: OperationIntent | null) {
  if (!intent) return "operation:closed";
  if (intent.kind === "account") {
    return `account:${intent.uid}:${intent.action}`;
  }
  if (intent.kind === "device-unlink") return `device-unlink:${intent.uid}:${intent.bindingId}`;
  if (intent.kind === "access") {
    return `access:${intent.uid}:${intent.scope}:${intent.targetId || "all"}`;
  }
  return `subscription:${intent.subscriptionId}:${intent.action}`;
}

function normalizedEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function validEmail(value: unknown) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail(value));
}

function useDebouncedValue<T>(value: T, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

function useRecordProtection(page: "users" | "subscriptions", recordId: string, mode: ProtectionMode | null) {
  const retainRecord = useCallback((route: AppRoute) => {
    const key = page === "users" ? "user" : "subscription";
    return (new URLSearchParams(route.state).get(key) || "") === recordId;
  }, [page, recordId]);
  return useAdminNavigationProtection(page, mode, retainRecord);
}

type UserDetailPermissions = {
  canReadAudit: boolean;
  canReadDiagnostics: boolean;
  canResolveAlerts: boolean;
  canManageAccounts: boolean;
  canEndAccess: boolean;
  canReadSubscriptions: boolean;
  canManageSubscriptions: boolean;
};

export function AdminUsers({ navigate, routeState, ...permissions }: UserDetailPermissions & { navigate: Navigate; routeState?: string }) {
  const { locale, formatNumber } = useExperience();
  const { admin } = useAdapters();
  const listRoot = useRef<HTMLDivElement>(null);
  const params = new URLSearchParams(routeState);
  const selectedId = params.get("user") || "";
  const directory = readUserDirectoryState(routeState);
  const { query, page, accountStatus, subscription } = directory;
  const { value: search, setValue: setSearch, pending: pendingSearch } = useRouteSearchDraft(query,
    JSON.stringify([query, page, accountStatus, subscription, selectedId]), selectedId ? undefined : (value) => {
      navigate(userDirectoryRoute({ ...directory, query: value, page: 1 }), { preserveScroll: true, replace: true });
    });
  const changeDirectory = (patch: Partial<UserDirectoryState>) => navigate(userDirectoryRoute({ ...directory, query: search.trim(), page: 1, ...patch }), { preserveScroll: true });
  const listRoute = userDirectoryRoute(directory);
  const userRoute = (row: AdminUserDirectoryItem) => userDirectoryRoute(directory, row.firebase_uid);
  const preview = useRecordPreview(JSON.stringify([query, page, accountStatus, subscription, selectedId]), listRoot);
  const resource = useAsyncData(
    (signal) =>
      selectedId ? Promise.resolve(null) : admin.listUsers({
        search: query,
        page,
        limit: 25,
        accountStatus,
        subscription,
        sort: "activity_desc",
      }, signal),
    [admin],
    new URLSearchParams({ query, page: String(page), accountStatus, subscription, selectedId }).toString(),
  );
  const visibleDirectory = pendingSearch || resource.error ? null : resource.data;
  const previewedUser = resource.error ? undefined : resource.data?.items.find((row) => row.firebase_uid === preview.activeKey);
  useRecordReturnFocus(selectedId, Boolean(visibleDirectory && !resource.loading), listRoot);
  const columns: Column<AdminUserDirectoryItem>[] = [
    {
      key: "user",
      header: copy(locale, "User", "المستخدم"),
      render: (row) => (
        <div>
          <RouteLink route={userRoute(row)} navigate={navigate}><strong>{row.display_name || row.email}</strong></RouteLink>
          <small className="block secondary">{row.email}</small>
        </div>
      ),
    },
    {
      key: "account",
      header: copy(locale, "Account", "الحساب"),
      render: (row) => (
        <Badge tone={tone(row.account_status)}>
          {statusLabel(row.account_status, locale)}
        </Badge>
      ),
    },
    {
      key: "subscription",
      header: copy(locale, "Subscription", "الاشتراك"),
      render: (row) => (
        <Badge tone={tone(row.subscription_presence)}>
          {statusLabel(row.subscription_presence, locale)}
        </Badge>
      ),
    },
    {
      key: "sessions",
      header: copy(locale, "Sessions / devices", "الجلسات / الأجهزة"),
    render: (row) => `${row.session_count} / ${row.device_count}`,
    },
    {
      key: "activity",
      header: copy(locale, "Last activity", "آخر نشاط"),
      render: (row) => date(row.last_activity_at, locale),
    },
  ];
  if (selectedId) return <UserDetailPage key={selectedId} userId={selectedId} {...permissions} navigate={navigate}
    parentRoute={listRoute} onChanged={resource.reload}
    requestedView={params.get("user_tab") || "overview"}
    onView={(view) => {
      const next = new URLSearchParams(params);
      if (view === "overview") next.delete("user_tab"); else next.set("user_tab", view);
      navigate({ surface: "admin", page: "users", state: "?" + next }, { preserveScroll: true });
    }} />;
  return (
    <div className="stack" ref={listRoot}>
      <PageHeader title={copy(locale, "Users", "المستخدمون")} />
      <TableToolbar
        searchLabel={copy(
          locale,
          "Search by name, email, or UID",
          "ابحث بالاسم أو البريد أو المعرّف",
        )}
        searchValue={search}
        onSearch={(value) => setSearch(value.replace(/\p{Cc}/gu, "").slice(0, 254))}
        action={query || accountStatus || subscription || pendingSearch ? <Button size="sm" variant="ghost"
          onClick={() => { setSearch(""); changeDirectory({ query: "", accountStatus: "", subscription: "" }); }}>{copy(locale, "Clear filters", "مسح الفلاتر")}</Button> : undefined}
        filters={
          <>
            <Select
              aria-label={copy(locale, "Account status", "حالة الحساب")}
              value={accountStatus}
              onChange={(event) => changeDirectory({ accountStatus: event.target.value as UserDirectoryState["accountStatus"] })}
            >
              <option value="">
                {copy(locale, "All account states", "كل حالات الحساب")}
              </option>
              {USER_ACCOUNT_STATES.map((value) => <option key={value} value={value}>{statusLabel(value, locale)}</option>)}
            </Select>
            <Select
              aria-label={copy(
                locale,
                "Subscription presence",
                "وجود الاشتراك",
              )}
              value={subscription}
              onChange={(event) => changeDirectory({ subscription: event.target.value as UserDirectoryState["subscription"] })}
            >
              <option value="">
                {copy(locale, "All subscription states", "كل حالات الاشتراك")}
              </option>
              {USER_SUBSCRIPTION_STATES.map((value) => <option key={value} value={value}>{statusLabel(value, locale)}</option>)}
            </Select>
          </>
        }
      />
      <AdminRecordPreviewLayout panel={previewedUser ? (
        <AdminRecordPreview key={previewedUser.firebase_uid} id={preview.panelId}
          title={previewedUser.display_name || previewedUser.email || previewedUser.firebase_uid}
          description={previewedUser.display_name ? previewedUser.email : undefined}
          icon={<UserRound size={18} />} recordRoute={userRoute(previewedUser)} navigate={navigate} onClose={preview.dismiss}>
          <dl className="detail-list">
            <div><dt>{copy(locale, "Account", "الحساب")}</dt><dd><Badge tone={tone(previewedUser.account_status)}>{statusLabel(previewedUser.account_status, locale)}</Badge></dd></div>
            {permissions.canReadSubscriptions ? <div><dt>{copy(locale, "Subscription", "الاشتراك")}</dt><dd><Badge tone={tone(previewedUser.subscription_presence)}>{statusLabel(previewedUser.subscription_presence, locale)}</Badge></dd></div> : null}
            <div><dt>{copy(locale, "Last activity", "آخر نشاط")}</dt><dd>{date(previewedUser.last_activity_at, locale)}</dd></div>
            <div><dt>{copy(locale, "Created on", "تاريخ الإنشاء")}</dt><dd>{date(previewedUser.created_at, locale)}</dd></div>
          </dl>
        </AdminRecordPreview>
      ) : null}>
      {!pendingSearch && resource.error ? (
        <Alert
          title={copy(locale, "Could not load users", "تعذر تحميل المستخدمين")}
          tone="danger"
          action={<Button onClick={resource.reload}>{copy(locale, "Retry", "إعادة المحاولة")}</Button>}
        />
      ) : (
        <AdminDataTable
          columns={columns}
          rows={visibleDirectory?.items || []}
          loading={pendingSearch || resource.loading}
          rowKey={(row) => row.firebase_uid}
          onRowClick={(row) => preview.toggle(row.firebase_uid)}
          rowAction={{ header: copy(locale, "Actions", "الإجراءات"), label: copy(locale, "Preview", "معاينة"),
            accessibleLabel: (row) => copy(locale, `Preview account ${row.email || row.firebase_uid}`, `معاينة حساب ${row.email || row.firebase_uid}`),
            disclosure: { panelId: preview.panelId, activeKey: previewedUser?.firebase_uid || "" } }}
          emptyTitle={page > 1 ? copy(locale, "No users on this page", "لا يوجد مستخدمون في هذه الصفحة") : copy(locale, "No users found", "لا يوجد مستخدمون")}
          emptyBody={copy(
            locale,
            "Change the search or filters.",
            "غيّر البحث أو عوامل التصفية.",
          )}
        />
      )}
      {page > 1 && visibleDirectory?.items.length === 0 ? <Button size="sm" variant="ghost"
        onClick={() => changeDirectory({ page: 1 })}>{copy(locale, "Return to first page", "العودة للصفحة الأولى")}</Button> : null}
      {visibleDirectory ? (
        <Pagination
          page={page}
          pages={Math.max(
            page,
            Math.ceil(visibleDirectory.total / visibleDirectory.limit),
          )}
          label={copy(
            locale,
            `${formatNumber(visibleDirectory.total)} users`,
            `${formatNumber(visibleDirectory.total)} مستخدم`,
          )}
          previousLabel={copy(locale, "Previous", "السابق")}
          nextLabel={copy(locale, "Next", "التالي")}
          onChange={(next) => changeDirectory({ page: next })}
        />
      ) : null}
      </AdminRecordPreviewLayout>
    </div>
  );
}

function UserDetailPage({
  userId,
  canReadAudit,
  canReadDiagnostics,
  canResolveAlerts,
  canManageAccounts,
  canEndAccess,
  canReadSubscriptions,
  canManageSubscriptions,
  navigate,
  parentRoute,
  onChanged,
  requestedView,
  onView,
}: UserDetailPermissions & {
  userId: string;
  navigate: Navigate;
  parentRoute: AppRoute;
  onChanged: () => void;
  requestedView: string;
  onView: (view: string) => void;
}) {
  const { locale } = useExperience();
  const { admin } = useAdapters();
  const detail = useResource(
    (signal) =>
      admin.getUserDetail(userId, signal),
    [admin, userId],
  );
  const [operation, setOperation] = useState<OperationIntent | null>(null);
  const [recoveryEvidence, setRecoveryEvidence] = useState<
    NonNullable<AdminUserDetail["recovery_evidence"]>[number] | null
  >(null);
  const [operationApplied, setOperationApplied] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);
  const data = detail.data;
  const profile = data?.profile;
  const accountStatus = data?.profile.account_status;
  const currentSubscription = data ? currentAccountSubscription(data) : null;
  const canExtendSubscription = ["trialing", "active", "past_due", "cancel_at_period_end"].includes(data?.subscription_projection?.lifecycle || "");
  const lifecycleAction = accountStatus === "active" ? "suspend"
    : accountStatus === "suspended" || accountStatus === "pending_deletion" ? "reactivate" : null;
  const closeOperation = () => setOperation(null);
  const changed = () => {
    closeOperation();
    detail.reload();
    onChanged();
  };
  const views = [
    { id: "overview", label: copy(locale, "Overview", "نظرة عامة") },
    { id: "access", label: copy(locale, "Devices and access", "الأجهزة والوصول") },
    { id: "support", label: copy(locale, "Support", "الدعم") },
    ...(canReadDiagnostics ? [{ id: "diagnostics", label: copy(locale, "Diagnostics", "التشخيصات") }] : []),
    ...(canReadAudit ? [{ id: "activity", label: copy(locale, "Admin activity", "النشاط الإداري") }] : []),
  ];
  const view = views.some((item) => item.id === requestedView) ? requestedView : "overview";
  if (recoveryEvidence && canManageSubscriptions) return <SubscriptionRecoveryPage key={recoveryEvidence.id}
    evidence={recoveryEvidence} user={data || null}
    onClose={() => setRecoveryEvidence(null)}
    onChanged={() => { setRecoveryEvidence(null); changed(); }} />;
  if (grantOpen && canManageSubscriptions && profile?.email) return <ManualGrantPage
    page="users" account={{ email: profile.email, firebase_uid: profile.firebase_uid, plan: currentSubscription?.plan_term }}
    onClose={() => setGrantOpen(false)}
    onChanged={() => { setGrantOpen(false); setOperationApplied(true); changed(); }} />;
  return (
    <>
      <AdminRecordPage
        parentRoute={parentRoute}
        navigate={navigate}
        parentLabel={copy(locale, "Users", "المستخدمون")}
        title={
          profile?.display_name ||
          profile?.email ||
          copy(locale, "User details", "تفاصيل المستخدم")
        }
        description={profile?.email || undefined}
        actions={<Button size="sm" disabled={detail.loading} onClick={detail.reload} leadingIcon={<RefreshCcw size={15} aria-hidden="true" />}>{copy(locale, "Refresh account", "تحديث الحساب")}</Button>}
      >
        <div className="stack">
          {operationApplied ? <Alert tone="success" title={copy(locale, "Change applied", "تم تنفيذ التغيير")} /> : null}
          {detail.loading ? (
            <SkeletonStack rows={8} />
          ) : detail.error ? (
            <Alert
              title={copy(
                locale,
                "Could not load user details",
                "تعذر تحميل تفاصيل المستخدم",
              )}
              tone="danger"
            >
              <Button size="sm" onClick={detail.reload}>{copy(locale, "Retry", "إعادة المحاولة")}</Button>
            </Alert>
          ) : data ? (
            <>
              <div className="cluster" aria-label={copy(locale, "Account status", "حالة الحساب")}>
                <Badge tone={tone(data.profile.account_status)}>{statusLabel(data.profile.account_status, locale)}</Badge>
                <span className="secondary">{data.profile.email_verified_at
                  ? copy(locale, "Email verified", "البريد متحقق منه")
                  : copy(locale, "Email not verified", "البريد غير متحقق منه")}</span>
              </div>
              <Tabs items={views} active={view} onChange={onView} ariaLabel={copy(locale, "Account sections", "أقسام الحساب")}>
              {view === "overview" ? <>
              <details className="admin-record-metadata">
                <summary>{copy(locale, "Account details", "تفاصيل الحساب")}</summary>
                <dl className="detail-list">
                  <div>
                    <dt>{copy(locale, "Firebase UID", "معرّف Firebase")}</dt>
                    <dd className="mono">{data.profile.firebase_uid}</dd>
                  </div>
                  <div>
                    <dt>{copy(locale, "Verification", "التحقق")}</dt>
                    <dd>
                      {data.profile.email_verified_at
                        ? date(data.profile.email_verified_at, locale)
                        : copy(locale, "Not verified", "غير متحقق")}
                    </dd>
                  </div>
                  <div>
                    <dt>{copy(locale, "Locale", "اللغة")}</dt>
                    <dd>{data.profile.locale || "—"}</dd>
                  </div>
                </dl>
              </details>
              <section>
                <SectionHeader
                  title={copy(locale, "Subscription", "الاشتراك")}
                  action={<div className="cluster">
                    {currentSubscription && canReadSubscriptions ? <RouteLink className="ui-button ui-button--secondary ui-button--sm"
                      route={{ surface: "admin", page: "subscriptions", state: "?" + new URLSearchParams({ subscription: currentSubscription.id }) }} navigate={navigate}>
                      {copy(locale, canManageSubscriptions ? "Manage subscription" : "Subscription details", canManageSubscriptions ? "إدارة الاشتراك" : "تفاصيل الاشتراك")}
                    </RouteLink> : null}
                    {canManageSubscriptions ? <Button size="sm" variant="primary" onClick={() => setGrantOpen(true)}>
                      {copy(locale, canExtendSubscription ? "Extend subscription" : "Grant subscription", canExtendSubscription ? "تمديد الاشتراك" : "منح اشتراك")}
                    </Button> : null}
                  </div>}
                />
                <dl className="detail-list">
                  <div>
                    <dt>{copy(locale, "App access", "الوصول للأداة")}</dt>
                    <dd>
                      {statusLabel(
                        data.subscription_projection?.entitlement,
                        locale,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{copy(locale, "Plan", "الخطة")}</dt>
                    <dd>
                      {data.subscription_projection?.plan_term
                        ? statusLabel(data.subscription_projection.plan_term, locale)
                        : copy(locale, "No subscription", "لا يوجد اشتراك")}
                    </dd>
                  </div>
                  <div>
                    <dt>{copy(locale, "Subscription history", "سجل الاشتراكات")}</dt>
                    <dd>{canReadSubscriptions ? <RouteLink
                      className="ui-button ui-button--ghost ui-button--sm"
                      route={{ surface: "admin", page: "subscriptions", state: `?${new URLSearchParams({ search: data.profile.firebase_uid })}` }}
                      navigate={navigate}>
                      {copy(locale, "View account subscriptions", "عرض اشتراكات الحساب")}
                    </RouteLink> : copy(locale, "Not permitted", "غير مسموح")}</dd>
                  </div>
                  <div>
                    <dt>{copy(locale, "Integrity", "سلامة البيانات")}</dt>
                    <dd>{data.subscription_integrity?.integrity ? statusLabel(data.subscription_integrity.integrity, locale) : copy(locale, "Unavailable", "غير متاح")}</dd>
                  </div>
                </dl>
              </section>
              </> : null}
              {view === "access" ? <>
              <section>
                <SectionHeader
                  title={copy(
                    locale,
                    "Desktop device",
                    "جهاز سطح المكتب",
                  )}
                  action={canEndAccess && data.device_binding ? (
                    <Button size="sm" onClick={() => {
                      const binding = data.device_binding;
                      if (!binding) return;
                      setOperation({ kind: "device-unlink", uid: data.profile.firebase_uid, bindingId: binding.id,
                        deviceLabel: binding.device_name || binding.device_key });
                    }}>
                      {copy(locale, "Unlink device", "فك ربط الجهاز")}
                    </Button>
                  ) : null}
                />
                {data.device_binding ? (
                  <dl className="detail-list">
                    <div><dt>{copy(locale, "Device", "الجهاز")}</dt><dd>{data.device_binding.device_name || data.device_binding.device_key}</dd></div>
                    <div><dt>{copy(locale, "Platform", "النظام")}</dt><dd>{[data.device_binding.platform, data.device_binding.os_version].filter(Boolean).join(" · ") || "—"}</dd></div>
                    <div><dt>{copy(locale, "Linked", "تاريخ الربط")}</dt><dd>{date(data.device_binding.bound_at, locale)}</dd></div>
                    <div><dt>{copy(locale, "Last activity", "آخر نشاط")}</dt><dd>{date(data.device_binding.last_seen_at, locale)}</dd></div>
                  </dl>
                ) : (
                  <EmptyState variant="section" title={copy(locale, "No linked desktop device", "لا يوجد جهاز سطح مكتب مرتبط")} body="" />
                )}
                {data.device_change_requests?.length ? (
                  <AdminDataTable emptyVariant="section"
                    columns={[
                      { key: "device", header: copy(locale, "Requested device", "الجهاز المطلوب"), render: (row) => (
                        <RouteLink className="admin-overview__record" route={deviceRequestsRoute(row.status, 1, row.id)} navigate={navigate}>
                          <strong><bdi>{row.device_name || copy(locale, "Desktop device", "جهاز سطح مكتب")}</bdi></strong>
                        </RouteLink>
                      ) },
                      { key: "status", header: copy(locale, "Status", "الحالة"), render: (row) => <Badge tone={deviceRequestTone(row.status)}>{deviceRequestStatusLabel(row.status, locale)}</Badge> },
                      { key: "requested", header: copy(locale, "Requested", "تاريخ الطلب"), render: (row) => date(row.requested_at, locale) },
                    ]}
                    rows={data.device_change_requests}
                    rowKey={(row) => row.id}
                    emptyTitle=""
                    emptyBody=""
                  />
                ) : null}
              </section>
              <section>
                <SectionHeader title={copy(locale, "Sessions", "الجلسات")} action={canEndAccess ? (
                  <Button size="sm" onClick={() => setOperation({ kind: "access", uid: data.profile.firebase_uid, scope: "all" })}>
                    {operationLabel(locale, { kind: "access", uid: data.profile.firebase_uid, scope: "all" })}
                  </Button>
                ) : null} />
                <AdminDataTable emptyVariant="section"
                  columns={[
                    {
                      key: "device",
                      header: copy(locale, "Device", "الجهاز"),
                      render: (row: Record<string, unknown>) =>
                        String(row.device_key || "—"),
                    },
                    {
                      key: "created",
                      header: copy(locale, "Created", "الإنشاء"),
                      render: (row) => date(row.created_at, locale),
                    },
                    {
                      key: "activity",
                      header: copy(locale, "Last activity", "آخر نشاط"),
                      render: (row) => date(row.last_seen_at, locale),
                    },
                    {
                      key: "status",
                      header: copy(locale, "Status", "الحالة"),
                      render: (row) => (
                        <Badge tone={row.revoked_at ? "neutral" : "success"}>
                          {row.revoked_at
                            ? copy(locale, "Revoked", "ملغاة")
                            : copy(locale, "Active", "نشطة")}
                        </Badge>
                      ),
                    },
                    ...(canEndAccess ? [{
                      key: "action",
                      narrow: "action" as const,
                      header: copy(locale, "Action", "الإجراء"),
                      render: (row: Record<string, unknown>) =>
                        row.revoked_at || !row.id ? (
                          "—"
                        ) : (
                          <Button
                            size="sm"
                            onClick={() =>
                              setOperation({
                                kind: "access",
                                uid: data.profile.firebase_uid,
                                scope: "session",
                                targetId: String(row.id || ""),
                              })
                            }
                          >
                            {copy(locale, "End session", "إنهاء الجلسة")}
                          </Button>
                        ),
                    }] : []),
                  ]}
                  rows={data.sessions || []}
                  rowKey={(row) => String(row.id)}
                  emptyTitle={copy(locale, "No sessions", "لا توجد جلسات")}
                  emptyBody={copy(
                    locale,
                    "This account has no recorded app sessions.",
                    "لا توجد جلسات مسجلة لهذا الحساب.",
                  )}
                />
              </section>
              <section>
                <SectionHeader
                  title={copy(locale, "Access requests", "طلبات الوصول")}
                />
                <AdminDataTable emptyVariant="section"
                  columns={[
                    {
                      key: "device",
                      header: copy(locale, "Device", "الجهاز"),
                      render: (row: Record<string, unknown>) =>
                        String(row.device_key || "—"),
                    },
                    {
                      key: "status",
                      header: copy(locale, "Status", "الحالة"),
                      render: (row) => (
                        <Badge tone={tone(row.status)}>
                          {statusLabel(row.status, locale)}
                        </Badge>
                      ),
                    },
                    {
                      key: "created",
                      header: copy(locale, "Created", "الإنشاء"),
                      render: (row) => date(row.created_at, locale),
                    },
                    {
                      key: "expiry",
                      header: copy(locale, "Expiry", "الانتهاء"),
                      render: (row) => date(row.expires_at, locale),
                    },
                  ]}
                  rows={data.login_requests || []}
                  rowKey={(row) => String(row.id)}
                  emptyTitle={copy(
                    locale,
                    "No access requests",
                    "لا توجد طلبات وصول",
                  )}
                  emptyBody={copy(
                    locale,
                    "Device login requests will appear here.",
                    "ستظهر طلبات ربط الأجهزة هنا.",
                  )}
                />
              </section>
              </> : null}
              {view === "support" ? <section>
                <SectionHeader title={copy(locale, "Support", "الدعم")} />
                <AdminDataTable emptyVariant="section"
                  columns={[
                    {
                      key: "subject",
                      header: copy(locale, "Subject", "الموضوع"),
                      render: (row) => (
                        <RouteLink className="admin-overview__record" route={{ surface: "admin", page: "support", state: `?${new URLSearchParams({ thread: row.id })}` }} navigate={navigate}>
                          <strong><bdi>{row.subject}</bdi></strong>
                        </RouteLink>
                      ),
                    },
                    {
                      key: "status",
                      header: copy(locale, "Status", "الحالة"),
                      render: (row) => (
                        <Badge tone={supportStatusTone(row.status)}>
                          {supportStatusLabel(row.status, locale)}
                        </Badge>
                      ),
                    },
                    {
                      key: "priority",
                      header: copy(locale, "Priority", "الأولوية"),
                      render: (row) => statusLabel(row.priority, locale),
                    },
                    {
                      key: "updated",
                      header: copy(locale, "Updated", "آخر تحديث"),
                      render: (row) => date(row.updated_at, locale),
                    },
                  ]}
                  rows={data.support_threads || []}
                  rowKey={(row) => row.id}
                  emptyTitle={copy(
                    locale,
                    "No support threads",
                    "لا توجد محادثات دعم",
                  )}
                  emptyBody={copy(
                    locale,
                    "Support conversations for this account will appear here.",
                    "ستظهر محادثات الدعم الخاصة بهذا الحساب هنا.",
                  )}
                />
              </section> : null}
              {view === "overview" && canManageSubscriptions && data.recovery_evidence?.some(
                (item) => item.status === "available",
              ) ? (
                <section>
                  <SectionHeader
                    title={copy(
                      locale,
                      "Subscription recovery",
                      "استعادة الاشتراك",
                    )}
                  />
                  <AdminDataTable emptyVariant="section"
                    columns={[
                      {
                        key: "source",
                        header: copy(locale, "Evidence", "المرجع"),
                        render: (row) => row.evidence_type,
                      },
                      {
                        key: "remaining",
                        header: copy(
                          locale,
                          "Remaining time",
                          "المدة المتبقية",
                        ),
                        render: (row) =>
                          copy(
                            locale,
                            `${Math.ceil(row.remaining_seconds / 86400)} days`,
                            `${Math.ceil(row.remaining_seconds / 86400)} يوم`,
                          ),
                      },
                      {
                        key: "expiry",
                        header: copy(
                          locale,
                          "Evidence expiry",
                          "انتهاء المرجع",
                        ),
                        render: (row) => date(row.expires_at, locale),
                      },
                      {
                        key: "action",
                        narrow: "action" as const,
                        header: copy(locale, "Action", "الإجراء"),
                        render: (row) => (
                          <Button
                            size="sm"
                            onClick={() => setRecoveryEvidence(row)}
                          >
                            {copy(locale, "Restore time", "استعادة المدة")}
                          </Button>
                        ),
                      },
                    ]}
                    rows={data.recovery_evidence.filter(
                      (item) => item.status === "available",
                    )}
                    rowKey={(row) => row.id}
                    emptyTitle={copy(
                      locale,
                      "No recovery evidence",
                      "لا يوجد مرجع للاستعادة",
                    )}
                    emptyBody=""
                  />
                </section>
              ) : null}
              {view === "activity" && canReadAudit ? <section>
                <SectionHeader title={copy(locale, "Admin activity", "النشاط الإداري")} />
                {data.audit == null ? <Alert tone="warning" title={copy(locale, "Admin activity could not be loaded.", "تعذّر تحميل النشاط الإداري.")}
                  action={<Button onClick={detail.reload}>{copy(locale, "Retry", "إعادة المحاولة")}</Button>} />
                  : <><p className="secondary">{copy(locale, "Recent actions linked to this account, up to 50 entries.", "آخر الإجراءات المرتبطة بالحساب، حتى 50 سجلًا.")}</p>
                  <AdminDataTable emptyVariant="section" rows={data.audit} rowKey={(row) => row.id || String(row.timestamp)}
                    emptyTitle={copy(locale, "No recorded admin activity", "لا يوجد نشاط إداري مسجّل")} emptyBody=""
                    columns={[
                      { key: "action", header: copy(locale, "Action", "الإجراء"), render: (row) => auditActionLabel(row.action || row.type, locale) },
                      { key: "actor", header: copy(locale, "Actor", "المنفّذ"), render: (row) => <bdi>{row.actor || row.admin_email || "—"}</bdi> },
                      { key: "time", header: copy(locale, "Time", "الوقت"), render: (row) => date(row.timestamp || row.happened_at || row.at, locale) },
                      { key: "request", header: copy(locale, "Request", "الطلب"), render: (row) => row.request_id ? <RouteLink
                        route={{ surface: "admin", page: "audit", state: "?" + new URLSearchParams({ search: row.request_id }) }} navigate={navigate}>
                          {copy(locale, "Find request events", "البحث عن إجراءات الطلب")}
                        </RouteLink> : "—" },
                    ]} /></>}
              </section> : null}
              {view === "diagnostics" && canReadDiagnostics ? <section>
                <SectionHeader title={copy(locale, "Diagnostics", "التشخيصات")} />
                <Accordion initiallyOpen={false} items={[
                  { id: "reports", title: copy(locale, "Diagnostic reports", "تقارير التشخيص"), body: <AccountDiagnosticContent><DiagnosticReportHistory filters={{ user: data.profile.firebase_uid }} /></AccountDiagnosticContent> },
                  { id: "alerts", title: copy(locale, "Open tamper alerts", "تنبيهات العبث المفتوحة"), body: <AccountDiagnosticContent><TamperAlertsPanel userId={data.profile.firebase_uid} canDecide={canResolveAlerts} /></AccountDiagnosticContent> },
                ]} />
              </section> : null}
              {view === "overview" && canManageAccounts && lifecycleAction ? <section className="danger-zone">
                <SectionHeader
                  title={copy(locale, "Account actions", "إجراءات الحساب")}
                />
                <div className="cluster">
                  <Button
                    onClick={() =>
                      setOperation({
                        kind: "account",
                        uid: data.profile.firebase_uid,
                        action: lifecycleAction,
                      })
                    }
                  >
                    {operationLabel(locale, { kind: "account", uid: data.profile.firebase_uid, action: lifecycleAction })}
                  </Button>
                  {accountStatus !== "pending_deletion" ? <Button
                    variant="ghost"
                    onClick={() =>
                      setOperation({
                        kind: "account",
                        uid: data.profile.firebase_uid,
                        action: "mark_pending_deletion",
                      })
                    }
                  >
                    {operationLabel(locale, { kind: "account", uid: data.profile.firebase_uid, action: "mark_pending_deletion" })}
                  </Button> : null}
                </div>
              </section> : null}
              </Tabs>
            </>
          ) : null}
        </div>
      </AdminRecordPage>
      <AdminOperationDialog
        key={operationIntentKey(operation)}
        page="users"
        intent={operation && (operation.kind === "account" ? canManageAccounts : canEndAccess) ? operation : null}
        onClose={closeOperation}
        onChanged={() => { setOperationApplied(true); changed(); }}
        onRefresh={() => { setOperationApplied(false); changed(); }}
      />
    </>
  );
}

function SubscriptionRecoveryPage({
  evidence,
  user,
  onClose,
  onChanged,
}: {
  evidence: NonNullable<AdminUserDetail["recovery_evidence"]>[number] | null;
  user: AdminUserDetail | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { locale } = useExperience();
  const { admin } = useAdapters();
  const source = user?.subscription_history?.find(
    (row) => String(row.id || "") === String(evidence?.subscription_id || ""),
  );
  const inferred = String(source?.plan_term || source?.plan || "monthly");
  const initialPlan = inferred === "weekly" || inferred === "annual" || inferred === "lifetime" ? inferred : "monthly";
  const [plan, setPlan] = useState<
    "weekly" | "monthly" | "annual" | "lifetime"
  >(initialPlan);
  const [note, setNote] = useState("");
  const [reviewed, setReviewed] = useState<ReviewedManualGrant | null>(null);
  const preview = reviewed?.preview;
  const [phase, setPhase] = useState<"review" | "execute" | null>(null);
  const busy = Boolean(phase);
  const inFlight = useRef(false);
  const fieldId = useId();
  const confirmClose = useRecordProtection("users", user?.profile.firebase_uid || "", evidence ? phase === "execute" ? "saving" : plan !== initialPlan || note.trim() ? "draft" : null : null);
  const [error, setError] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const input: ManualGrantPreviewInput | null =
    evidence && user
      ? {
          target_firebase_uid: user.profile.firebase_uid,
          target_email: user.profile.email,
          operation_type: "restore_remaining_time" as const,
          plan,
          duration_mode:
            plan === "lifetime" ? ("lifetime" as const) : ("duration" as const),
          duration_value: 1,
          duration_unit: "days" as const,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          reason_code: "subscription_recovery" as const,
          reason_note: note.trim() || undefined,
          recovery_evidence_id: evidence.id,
        }
      : null;
  const review = async () => {
    if (!input || inFlight.current) return;
    inFlight.current = true;
    setPhase("review");
    setError("");
    try {
      const result = await admin.previewManualGrant(input);
      setReviewed({ input, preview: result });
    } catch (failure) {
      setReviewed(null);
      setError(adminMutationError(locale, failure));
    } finally {
      inFlight.current = false;
      setPhase(null);
    }
  };
  const restore = async () => {
    if (!reviewed || reviewed.preview.blocked || inFlight.current) return;
    inFlight.current = true;
    setPhase("execute");
    setError("");
    try {
      await admin.executeManualGrant({
        ...reviewed.input,
        reason: reviewed.input.reason_note || "subscription_recovery",
        idempotency_key: idempotencyKey,
        preview_hash: reviewed.preview.preview_hash,
      });
      setIdempotencyKey(crypto.randomUUID());
      onChanged();
    } catch (failure) {
      setError(adminMutationError(locale, failure));
    } finally {
      inFlight.current = false;
      setPhase(null);
    }
  };
  return (
    <AdminTaskPage
      onBack={() => confirmClose(onClose)}
      busy={phase === "execute"}
      title={copy(
        locale,
        "Restore previous subscription time",
        "استعادة مدة اشتراك سابقة",
      )}
      description={copy(
        locale,
        "Review the evidence and resulting expiry before confirming.",
        "راجع المرجع وتاريخ الانتهاء الناتج قبل التأكيد.",
      )}
      backLabel={copy(locale, "Back to account", "العودة للحساب")}
      footer={
        <>
          <Button onClick={review} disabled={busy} loading={phase === "review"}>
            {copy(locale, "Review changes", "مراجعة التغييرات")}
          </Button>
          <Button
            variant="primary"
            onClick={restore}
            disabled={!preview || preview.blocked || busy}
            loading={phase === "execute"}
          >
            {copy(locale, "Restore time", "استعادة المدة")}
          </Button>
        </>
      }
    >
      <div className="stack">
        <dl className="detail-list">
          <div>
            <dt>{copy(locale, "Evidence", "المرجع")}</dt>
            <dd>{evidence?.evidence_type || "—"}</dd>
          </div>
          <div>
            <dt>{copy(locale, "Remaining time", "المدة المتبقية")}</dt>
            <dd>
              {evidence
                ? copy(
                    locale,
                    `${Math.ceil(evidence.remaining_seconds / 86400)} days`,
                    `${Math.ceil(evidence.remaining_seconds / 86400)} يوم`,
                  )
                : "—"}
            </dd>
          </div>
        </dl>
        <FormField label={copy(locale, "Plan", "الخطة")} htmlFor={fieldId + "-plan"}>
          <Select
            id={fieldId + "-plan"}
            disabled={busy}
            value={plan}
            onChange={(event) => {
              setPlan(event.target.value as typeof plan);
              setReviewed(null);
            }}
          >
            <option value="weekly">{copy(locale, "Weekly", "أسبوعي")}</option>
            <option value="monthly">{copy(locale, "Monthly", "شهري")}</option>
            <option value="annual">{copy(locale, "Annual", "سنوي")}</option>
            <option value="lifetime">
              {copy(locale, "Lifetime", "مدى الحياة")}
            </option>
          </Select>
        </FormField>
        <FormField label={copy(locale, "Note", "ملاحظة")} htmlFor={fieldId + "-note"}>
          <Textarea
            id={fieldId + "-note"}
            disabled={busy}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setReviewed(null);
            }}
          />
        </FormField>
        {preview ? (
          <Alert
            title={copy(locale, "Recovery preview", "معاينة الاستعادة")}
            tone={preview.blocked ? "danger" : "info"}
          >
            {copy(
              locale,
              `New expiry: ${date(preview.proposed_state.expires_at, locale)}`,
              `الانتهاء الجديد: ${date(preview.proposed_state.expires_at, locale)}`,
            )}
          </Alert>
        ) : null}
        {error ? (
          <Alert
            title={copy(
              locale,
              "Could not restore the subscription",
              "تعذر استعادة الاشتراك",
            )}
            tone="danger"
          >
            {error}
          </Alert>
        ) : null}
      </div>
    </AdminTaskPage>
  );
}

export function AdminSubscriptions({ canManage, routeState, navigate }: {
  canManage: boolean; routeState?: string; navigate: Navigate;
}) {
  const { locale } = useExperience();
  const { admin } = useAdapters();
  const listRoot = useRef<HTMLDivElement>(null);
  const params = new URLSearchParams(routeState);
  const selectedId = params.get("subscription") || "";
  const directory = readSubscriptionDirectoryState(routeState);
  const { query, page, pendingPage, current, lifecycle } = directory;
  const [grantOpen, setGrantOpen] = useState(false);
  const [pendingToCancel, setPendingToCancel] = useState<PendingSubscriptionGrant | null>(null);
  const { value: search, setValue: setSearch, pending: searchPending } = useRouteSearchDraft(query,
    JSON.stringify([query, page, pendingPage, current, lifecycle, selectedId, grantOpen]), selectedId || grantOpen ? undefined : (value) => {
      navigate(subscriptionDirectoryRoute({ ...directory, query: value, page: 1 }), { preserveScroll: true, replace: true });
    });
  const changeDirectory = (patch: Partial<SubscriptionDirectoryState>) => navigate(subscriptionDirectoryRoute({ ...directory, query: search.trim(), page: 1, ...patch }), { preserveScroll: true });
  const listRoute = subscriptionDirectoryRoute(directory);
  const subscriptionRoute = (row: AdminSubscription) => subscriptionDirectoryRoute(directory, row.id);
  const preview = useRecordPreview(JSON.stringify([query, page, pendingPage, current, lifecycle, selectedId, grantOpen]), listRoot);
  const resource = useAsyncData(
    (signal) => selectedId ? Promise.resolve(null) : admin.listSubscriptions({ search: query, page, limit: 25, current, lifecycle }, signal),
    [admin], JSON.stringify([query, page, current, lifecycle, selectedId]),
  );
  const pendingGrants = useAsyncData(
    (signal) => admin.listPendingSubscriptionGrants("pending", pendingPage, signal),
    [admin], String(pendingPage),
  );
  const busy = resource.loading || resource.refreshing || searchPending;
  const previewedSubscription = resource.error ? undefined : resource.data?.items.find((row) => row.id === preview.activeKey);
  useRecordReturnFocus(selectedId, Boolean(resource.data && !busy), listRoot);
  const columns: Column<AdminSubscription>[] = [
    {
      key: "user",
      header: copy(locale, "User", "المستخدم"),
      render: (row) => <RouteLink route={subscriptionRoute(row)} navigate={navigate}>{row.user_email || row.firebase_user_id || "—"}</RouteLink>,
    },
    {
      key: "term",
      header: copy(locale, "Plan", "الخطة"),
      render: (row) =>
        statusLabel(row.plan_term || row.subscription_projection?.plan_term || row.plan, locale),
    },
    {
      key: "lifecycle",
      header: copy(locale, "Lifecycle", "دورة الاشتراك"),
      render: (row) => (
        <Badge tone={tone(subscriptionDisplayLifecycle(row))}>
          {statusLabel(subscriptionDisplayLifecycle(row), locale)}
        </Badge>
      ),
    },
    {
      key: "source",
      header: copy(locale, "Source", "المصدر"),
      render: (row) => subscriptionSourceLabel(row, locale),
    },
    {
      key: "end",
      header: copy(locale, "Period end", "نهاية الفترة"),
      render: (row) =>
        row.plan_term === "lifetime"
          ? copy(locale, "Lifetime", "مدى الحياة")
          : date(row.period_end_at || row.expires_at, locale),
    },
    {
      key: "current",
      header: copy(locale, "Record", "السجل"),
      render: (row) => {
        const isCurrentRecord = isCurrentSubscriptionRecord(row);
        return (
          <Badge tone={isCurrentRecord ? "info" : "neutral"}>
            {isCurrentRecord
              ? copy(locale, "Current", "حالي")
              : copy(locale, "History", "سابق")}
          </Badge>
        );
      },
    },
  ];
  const pendingColumns: Column<PendingSubscriptionGrant>[] = [
    {
      key: "email",
      header: copy(locale, "Email", "البريد"),
      render: (row) => <span className="mono table-primary-value">{row.normalized_email}</span>,
    },
    {
      key: "plan",
      header: copy(locale, "Plan", "الخطة"),
      render: (row) => statusLabel(row.plan_term, locale),
    },
    {
      key: "duration",
      header: copy(locale, "Duration", "المدة"),
      render: (row) => row.duration_mode === "lifetime"
        ? copy(locale, "Lifetime", "مدى الحياة")
        : row.duration_mode === "exact"
          ? date(row.exact_expiry, locale)
          : `${row.duration_value || "—"} ${statusLabel(row.duration_unit, locale)}`,
    },
    {
      key: "deadline",
      header: copy(locale, "Registration deadline", "مهلة التسجيل"),
      render: (row) => date(row.claim_deadline, locale),
    },
    ...(canManage ? [{
      key: "action",
      narrow: "action" as const,
      header: copy(locale, "Action", "الإجراء"),
      render: (row: PendingSubscriptionGrant) => (
        <Button size="sm" variant="text" onClick={() => setPendingToCancel(row)}>
          {copy(locale, "Cancel grant", "إلغاء المنح")}
        </Button>
      ),
    }] : []),
  ];
  if (selectedId) return <SubscriptionRecord key={selectedId} id={selectedId} canManage={canManage}
    parentRoute={listRoute} navigate={navigate} />;
  if (canManage && grantOpen) return <ManualGrantPage onClose={() => setGrantOpen(false)}
    onChanged={() => { resource.reload(); pendingGrants.reload(); }} />;
  return (
    <div className="stack" ref={listRoot}>
      <PageHeader
        title={copy(locale, "Subscriptions", "الاشتراكات")}
        actions={<div className="cluster">
          <Button size="sm" leadingIcon={<RefreshCcw size={15} aria-hidden="true" />}
            disabled={busy || pendingGrants.loading || pendingGrants.refreshing}
            onClick={() => { resource.reload(); pendingGrants.reload(); }}>{copy(locale, "Refresh", "تحديث")}</Button>
          {canManage ? <Button variant="primary" onClick={() => setGrantOpen(true)}>
            {copy(locale, "Grant subscription", "منح اشتراك")}
          </Button> : null}
        </div>}
      />
      {pendingGrants.loading ? <SkeletonStack rows={2} /> : null}
      {pendingGrants.error ? <Alert tone="warning" title={copy(locale, "Could not load grants awaiting registration", "تعذر تحميل المنح التي تنتظر التسجيل")}
        action={<Button size="sm" onClick={pendingGrants.reload}>{copy(locale, "Retry", "إعادة المحاولة")}</Button>} /> : null}
      {pendingGrants.data && !pendingGrants.error && (pendingGrants.data.total > 0 || pendingPage > 1) ? (
        <section className="admin-inline-section">
          <SectionHeader
            title={copy(locale, "Waiting for registration", "بانتظار التسجيل")}
            description={copy(
              locale,
              "These grants activate automatically after the matching email is verified.",
              "تُفعّل هذه المنح تلقائيًا بعد التحقق من البريد المطابق.",
            )}
          />
          <AdminDataTable
            columns={pendingColumns}
            rows={pendingGrants.data.items}
            loading={pendingGrants.loading || pendingGrants.refreshing}
            rowKey={(row) => row.id}
            emptyTitle={copy(locale, "No grants on this page", "لا توجد منح في هذه الصفحة")}
            emptyBody=""
          />
          {pendingGrants.data.total > 5 || pendingPage > 1 ? <Pagination page={pendingPage}
            pages={Math.max(pendingPage, Math.ceil(pendingGrants.data.total / 5))}
            label={copy(locale, "Grants awaiting registration", "المنح التي تنتظر التسجيل")}
            disabled={pendingGrants.loading || pendingGrants.refreshing}
            previousLabel={copy(locale, "Previous grants", "المنح السابقة")} nextLabel={copy(locale, "More grants", "منح أخرى")}
            onChange={(next) => changeDirectory({ page, pendingPage: next })} /> : null}
        </section>
      ) : null}
      <TableToolbar
        searchLabel={copy(
          locale,
          "Search by user identity",
          "ابحث بهوية المستخدم",
        )}
        searchValue={search}
        onSearch={(value) => setSearch(value.replace(/\p{Cc}/gu, "").slice(0, 200))}
        action={query || current || lifecycle || searchPending ? <Button size="sm" variant="ghost"
          onClick={() => { setSearch(""); changeDirectory({ query: "", current: "", lifecycle: "" }); }}>{copy(locale, "Clear filters", "مسح الفلاتر")}</Button> : undefined}
        filters={
          <>
            <Select
              aria-label={copy(locale, "Record type", "نوع السجل")}
              value={current}
              onChange={(event) => changeDirectory({ current: event.target.value as SubscriptionDirectoryState["current"] })}
            >
              <option value="">
                {copy(locale, "All records", "كل السجلات")}
              </option>
              <option value="current">
                {copy(locale, "Current only", "الحالية فقط")}
              </option>
              <option value="history">
                {copy(locale, "History only", "السابقة فقط")}
              </option>
            </Select>
            <Select
              aria-label={copy(locale, "Lifecycle", "دورة الاشتراك")}
              value={lifecycle}
              onChange={(event) => changeDirectory({ lifecycle: event.target.value as SubscriptionDirectoryState["lifecycle"] })}
            >
              <option value="">
                {copy(locale, "All lifecycle states", "كل حالات الاشتراك")}
              </option>
              {SUBSCRIPTION_LIFECYCLES.map((value) => (
                <option key={value} value={value}>
                  {statusLabel(value, locale)}
                </option>
              ))}
            </Select>
          </>
        }
      />
      <AdminRecordPreviewLayout panel={previewedSubscription ? (
        <AdminRecordPreview key={previewedSubscription.id} id={preview.panelId}
          title={previewedSubscription.user_email || previewedSubscription.firebase_user_id || previewedSubscription.id}
          icon={<CreditCard size={18} />} recordRoute={subscriptionRoute(previewedSubscription)} navigate={navigate} onClose={preview.dismiss}>
          <dl className="detail-list">
            <div><dt>{copy(locale, "Lifecycle", "دورة الاشتراك")}</dt><dd><Badge tone={tone(subscriptionDisplayLifecycle(previewedSubscription))}>{statusLabel(subscriptionDisplayLifecycle(previewedSubscription), locale)}</Badge></dd></div>
            <div><dt>{copy(locale, "Plan", "الخطة")}</dt><dd>{statusLabel(previewedSubscription.plan_term || previewedSubscription.subscription_projection?.plan_term || previewedSubscription.plan, locale)}</dd></div>
            <div><dt>{copy(locale, "Period end", "نهاية الفترة")}</dt><dd>{previewedSubscription.plan_term === "lifetime" ? copy(locale, "No expiry", "بلا انتهاء") : date(previewedSubscription.period_end_at || previewedSubscription.expires_at, locale)}</dd></div>
            <div><dt>{copy(locale, "Source", "المصدر")}</dt><dd>{subscriptionSourceLabel(previewedSubscription, locale)}</dd></div>
            <div><dt>{copy(locale, "Record", "السجل")}</dt><dd>{isCurrentSubscriptionRecord(previewedSubscription) ? copy(locale, "Current", "حالي") : copy(locale, "History", "سابق")}</dd></div>
          </dl>
          {previewedSubscription.integrity_warning ? <Alert tone="warning" title={copy(locale, "Subscription data conflict", "تعارض في بيانات الاشتراك")} /> : null}
        </AdminRecordPreview>
      ) : null}>
      {resource.error ? (
        <Alert
          title={copy(
            locale,
            "Could not load subscriptions",
            "تعذر تحميل الاشتراكات",
          )}
          tone="danger"
        >
          <Button size="sm" onClick={resource.reload}>{copy(locale, "Retry", "إعادة المحاولة")}</Button>
        </Alert>
      ) : (
        <AdminDataTable
          columns={columns}
          rows={resource.data?.items || []}
          loading={busy}
          rowKey={(row) => row.id}
          onRowClick={(row) => preview.toggle(row.id)}
          rowAction={{ header: copy(locale, "Actions", "الإجراءات"), label: copy(locale, "Preview", "معاينة"),
            accessibleLabel: (row) => `${copy(locale, `Preview subscription for ${row.user_email || row.firebase_user_id || row.id}`, `معاينة اشتراك ${row.user_email || row.firebase_user_id || row.id}`)} (${statusLabel(subscriptionDisplayLifecycle(row), locale)})`,
            disclosure: { panelId: preview.panelId, activeKey: previewedSubscription?.id || "" } }}
          emptyTitle={page > 1 ? copy(locale, "No subscriptions on this page", "لا توجد اشتراكات في هذه الصفحة") : copy(
            locale,
            "No subscriptions found",
            "لا توجد اشتراكات",
          )}
          emptyBody={copy(
            locale,
            "Try a different search or change the filters.",
            "جرّب بحثًا آخر أو غيّر الفلاتر.",
          )}
        />
      )}
      {page > 1 && resource.data?.items.length === 0 && !busy && !resource.error ? <Button size="sm" variant="ghost"
        onClick={() => changeDirectory({ page: 1 })}>{copy(locale, "Return to first page", "العودة للصفحة الأولى")}</Button> : null}
      {resource.data && !resource.error ? (
        <Pagination
          page={page}
          pages={Math.max(
            page,
            Math.ceil(resource.data.total / resource.data.limit),
          )}
          label={copy(
            locale,
            `${resource.data.total} subscriptions`,
            `${resource.data.total} اشتراك`,
          )}
          previousLabel={copy(locale, "Previous", "السابق")}
          nextLabel={copy(locale, "Next", "التالي")}
          disabled={busy}
          onChange={(next) => changeDirectory({ page: next })}
        />
      ) : null}
      </AdminRecordPreviewLayout>
      <PendingGrantCancelDialog
        key={pendingToCancel?.id || "pending-grant:closed"}
        grant={canManage ? pendingToCancel : null}
        onClose={() => setPendingToCancel(null)}
        onChanged={() => {
          setPendingToCancel(null);
          pendingGrants.reload();
        }}
      />
    </div>
  );
}

function PendingGrantCancelDialog({
  grant,
  onClose,
  onChanged,
}: {
  grant: PendingSubscriptionGrant | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { locale } = useExperience();
  const { admin } = useAdapters();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const fieldId = useId();
  const confirmClose = useRecordProtection("subscriptions", "", grant ? busy ? "saving" : reason.trim() ? "draft" : null : null);
  const close = () => { if (!inFlight.current) confirmClose(onClose); };
  const cancelGrant = async () => {
    if (!grant || reason.trim().length < 3 || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await admin.cancelPendingSubscriptionGrant(grant.id, reason.trim());
      onChanged();
    } catch (cause) {
      setError(adminMutationError(locale, cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      open={Boolean(grant)}
      onClose={close}
      closeDisabled={busy}
      title={copy(locale, "Cancel pending grant", "إلغاء المنح المعلّق")}
      description={grant?.normalized_email}
      closeLabel={copy(locale, "Close", "إغلاق")}
      size="sm"
      footer={
        <>
          <Button onClick={close} disabled={busy}>{copy(locale, "Keep grant", "الإبقاء على المنح")}</Button>
          <Button
            variant="danger"
            disabled={reason.trim().length < 3 || busy}
            loading={busy}
            onClick={cancelGrant}
          >
            {copy(locale, "Cancel grant", "إلغاء المنح")}
          </Button>
        </>
      }
    >
      <div className="stack stack--compact">
        <FormField label={copy(locale, "Reason", "السبب")} htmlFor={fieldId + "-reason"} required>
          <Textarea id={fieldId + "-reason"} disabled={busy} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
        </FormField>
        {error ? <Alert title={copy(locale, "Could not cancel the grant", "تعذر إلغاء المنح")} tone="danger">{error}</Alert> : null}
      </div>
    </Modal>
  );
}

function SubscriptionRecord({ id, canManage, parentRoute, navigate }: {
  id: string; canManage: boolean; parentRoute: AppRoute; navigate: Navigate;
}) {
  const { locale } = useExperience();
  const { admin } = useAdapters();
  const [saved, setSaved] = useState(false);
  const resource = useAsyncData(async (signal) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error("subscription_not_found");
    return admin.listSubscriptions({ id, limit: 1 }, signal);
  }, [admin, id]);
  const subscription = resource.data?.items[0];
  if (subscription && resource.error !== "subscription_not_found") return <SubscriptionDetail
    subscription={subscription} canManage={canManage} parentRoute={parentRoute} navigate={navigate}
    refreshing={resource.refreshing} error={resource.error} saved={saved}
    onChanged={() => { setSaved(true); resource.reload(); }}
    onRefresh={resource.reload} />;
  return <AdminRecordPage title={copy(locale, "Subscription details", "تفاصيل الاشتراك")}
    parentLabel={copy(locale, "Subscriptions", "الاشتراكات")} parentRoute={parentRoute} navigate={navigate}>
    {resource.loading ? <SkeletonStack rows={6} /> : resource.error && resource.error !== "subscription_not_found"
      ? <Alert tone="warning" title={copy(locale, "Could not load the subscription", "تعذّر تحميل الاشتراك")}
        action={<Button onClick={resource.reload}>{copy(locale, "Retry", "إعادة المحاولة")}</Button>} />
      : <EmptyState title={copy(locale, "Subscription not found", "الاشتراك مش موجود")}
        body={copy(locale, "Return to the subscription list to find the current record.", "ارجع لقائمة الاشتراكات للبحث عن السجل الحالي.")} />}
  </AdminRecordPage>;
}

function SubscriptionDetail({
  subscription,
  canManage,
  onChanged,
  onRefresh,
  parentRoute,
  navigate,
  refreshing,
  error,
  saved,
}: {
  subscription: AdminSubscription;
  canManage: boolean;
  onChanged: () => void;
  onRefresh: () => void;
  parentRoute: AppRoute;
  navigate: Navigate;
  refreshing: boolean;
  error: string | null;
  saved: boolean;
}) {
  const { locale } = useExperience();
  const [operation, setOperation] = useState<OperationIntent | null>(null);
  const isCurrentRecord = isCurrentSubscriptionRecord(subscription);
  const lifecycle = subscriptionDisplayLifecycle(subscription);
  const actions = subscriptionActions(subscription);
  const primaryActions = actions.filter((action) => ["correct_expiry", "suspend", "resume", "end_trial"].includes(action));
  const otherActions = actions.filter((action) => !primaryActions.includes(action));
  const openAction = (action: SubscriptionAction) => setOperation({ kind: "subscription", subscriptionId: subscription.id, action });
  return (
    <>
      <AdminRecordPage
        parentLabel={copy(locale, "Subscriptions", "الاشتراكات")}
        parentRoute={parentRoute}
        navigate={navigate}
        title={copy(locale, "Subscription details", "تفاصيل الاشتراك")}
        description={
          subscription.user_email ||
          subscription.firebase_user_id ||
          subscription.id
        }
        actions={<Button size="sm" disabled={refreshing} leadingIcon={<RefreshCcw size={15} aria-hidden="true" />} onClick={onRefresh}>{copy(locale, "Refresh", "تحديث")}</Button>}
      >
        {saved ? <Alert tone="success" title={copy(locale, "Subscription updated", "تم تحديث الاشتراك")} /> : null}
        {error ? <Alert tone="warning" title={copy(locale, "Refresh failed. Showing the previous subscription.", "تعذّر التحديث. المعروض هو آخر بيانات للاشتراك.")}
          action={<Button onClick={onRefresh}>{copy(locale, "Retry", "إعادة المحاولة")}</Button>} /> : null}
        <div className="stack admin-subscription-detail">
          <section className="admin-record-overview" aria-label={copy(locale, "Subscription summary", "ملخص الاشتراك")}>
            <div className="admin-record-overview__identity">
              <span className="admin-record-overview__icon"><CreditCard size={20} aria-hidden="true" /></span>
              <div><strong>{statusLabel(subscription.plan_term || subscription.plan, locale)}</strong>
                <span className="secondary">{subscriptionSourceLabel(subscription, locale)}</span></div>
              <Badge tone={tone(lifecycle)}>{statusLabel(lifecycle, locale)}</Badge>
            </div>
            <div className="admin-record-overview__date"><CalendarDays size={16} aria-hidden="true" /><div>
              <span className="secondary">{copy(locale, lifecycle === "expired" ? "Expired on" : "Period end", lifecycle === "expired" ? "انتهى في" : "نهاية الاشتراك")}</span>
              <strong>{subscription.plan_term === "lifetime" ? copy(locale, "No expiry", "بلا انتهاء") : date(subscription.period_end_at || subscription.expires_at, locale)}</strong>
            </div></div>
          </section>
          {subscription.integrity_warning ? (
            <Alert
              title={copy(locale, "Change blocked", "التغيير محظور")}
              tone="danger"
            >
              {copy(
                locale,
                "Resolve the subscription integrity conflict first.",
                "يجب حل تعارض بيانات الاشتراك أولًا.",
              )}
            </Alert>
          ) : !isCurrentRecord && lifecycle !== "suspended" ? (
            <Alert title={copy(locale, "Historical record", "سجل سابق")} tone="info">
              {copy(locale, "Historical subscriptions are read-only.", "الاشتراكات السابقة متاحة للعرض فقط.")}
            </Alert>
          ) : !canManage ? <p className="secondary">{copy(locale, "Your role allows viewing subscriptions only.", "صلاحيتك تسمح بعرض الاشتراكات فقط.")}</p>
          : actions.length ? <section className="admin-record-actions" aria-label={copy(locale, "Subscription actions", "إجراءات الاشتراك")}>
            <div className="cluster">{primaryActions.map((action, index) => <Button key={action}
              variant={index === 0 ? "primary" : "secondary"}
              leadingIcon={action === "correct_expiry" ? <CalendarDays size={15} aria-hidden="true" /> : action === "suspend" ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
              disabled={refreshing || Boolean(error)} onClick={() => openAction(action)}>{operationLabel(locale, { kind: "subscription", subscriptionId: subscription.id, action })}</Button>)}</div>
            {otherActions.length ? <details className="admin-record-more-actions"><summary>{copy(locale, "Cancellation", "إلغاء الاشتراك")}</summary>
              <div className="stack stack--compact">{otherActions.map((action) => <Button key={action} variant={action === "cancel_at_period_end" ? "secondary" : "danger"}
                disabled={refreshing || Boolean(error)} onClick={() => openAction(action)}>{operationLabel(locale, { kind: "subscription", subscriptionId: subscription.id, action })}</Button>)}</div>
            </details> : null}
          </section> : <p className="secondary">{lifecycle === "suspended" && subscription.subscription_projection?.existence === "present"
            ? copy(locale, "This account has another current subscription.", "للحساب اشتراك حالي آخر.")
            : copy(locale, "No changes are available for this subscription state.", "لا توجد إجراءات متاحة لهذه الحالة.")}</p>}
          <section className="admin-inline-section"><SectionHeader title={copy(locale, "Record details", "تفاصيل السجل")} />
            <dl className="detail-list">
              <div><dt>{copy(locale, "Subscription ID", "معرّف الاشتراك")}</dt><dd className="mono"><bdi>{subscription.id}</bdi></dd></div>
              <div><dt>{copy(locale, "Period start", "بداية الاشتراك")}</dt><dd>{date(subscription.period_start_at || subscription.created_at, locale)}</dd></div>
              <div><dt>{copy(locale, "Record", "السجل")}</dt><dd>{isCurrentRecord ? copy(locale, "Current", "حالي") : copy(locale, "History", "سابق")}</dd></div>
              {subscription.subscription_projection?.entitlement ? <div><dt>{copy(locale, "Access", "الوصول")}</dt><dd>{statusLabel(subscription.subscription_projection.entitlement, locale)}</dd></div> : null}
            </dl>
          </section>
        </div>
      </AdminRecordPage>
      <AdminOperationDialog
        key={operationIntentKey(operation)}
        page="subscriptions"
        intent={canManage ? operation : null}
        onClose={() => setOperation(null)}
        onChanged={() => {
          setOperation(null);
          onChanged();
        }}
        onRefresh={() => { setOperation(null); onRefresh(); }}
      />
    </>
  );
}

function ManualGrantPage({
  page = "subscriptions",
  account,
  onClose,
  onChanged,
}: {
  page?: "users" | "subscriptions";
  account?: Pick<AdminUserDirectoryItem, "email" | "firebase_uid"> & { plan?: string | null };
  onClose: () => void;
  onChanged: () => void;
}) {
  const { locale } = useExperience();
  const { admin } = useAdapters();
  const initialEmail = account?.email || "";
  const initialPlan = account?.plan === "weekly" || account?.plan === "annual" || account?.plan === "lifetime" ? account.plan : "monthly";
  const [search, setSearch] = useState(initialEmail);
  const [selected, setSelected] = useState<AdminUserDirectoryItem | null>(null);
  const [plan, setPlan] = useState<
    "weekly" | "monthly" | "annual" | "lifetime"
  >(initialPlan);
  const [duration, setDuration] = useState("30");
  const [unit, setUnit] = useState<"days" | "weeks" | "months">("days");
  const [reasonCode, setReasonCode] = useState<
    | "admin_grant"
    | "compensation"
    | "trial"
    | "technical_support"
    | "subscription_replacement"
    | "other"
  >("admin_grant");
  const [note, setNote] = useState("");
  const [reviewed, setReviewed] = useState<ReviewedManualGrant | null>(null);
  const preview = reviewed?.preview;
  const [phase, setPhase] = useState<"review" | "execute" | null>(null);
  const busy = Boolean(phase);
  const inFlight = useRef(false);
  const fieldId = useId();
  const dirty = Boolean(search.trim() !== initialEmail.trim() || selected || plan !== initialPlan || duration !== "30" || unit !== "days" || reasonCode !== "admin_grant" || note.trim());
  const confirmClose = useRecordProtection(page, account?.firebase_uid || "", phase === "execute" ? "saving" : dirty ? "draft" : null);
  const [error, setError] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const searchKey = search.trim();
  const debouncedSearch = useDebouncedValue(searchKey);
  const users = useAsyncData(
    (signal) =>
      debouncedSearch.length >= 2
        ? admin.listUsers({ search: debouncedSearch, exactEmail: validEmail(debouncedSearch), limit: 8 }, signal)
        : Promise.resolve({ items: [], total: 0, page: 1, limit: 8 }),
    [admin],
    debouncedSearch,
  );
  const lookupPending = debouncedSearch !== searchKey || users.loading || users.refreshing;
  const lookupReady = !lookupPending && !users.error;
  const typedEmail = validEmail(search) ? normalizedEmail(search) : "";
  const exactUser =
    (lookupReady ? users.data?.items.find(
      (user) => normalizedEmail(user.email) === typedEmail,
    ) : null) || null;
  const verifiedAccount = account && exactUser?.firebase_uid === account.firebase_uid ? exactUser : null;
  const targetUser = account ? verifiedAccount : selected || exactUser;
  const targetEmail = account ? verifiedAccount?.email : selected?.email || (lookupReady ? typedEmail : "");
  const operation =
    targetUser?.subscription_presence === "active"
      ? "extend_current"
      : "start_from_now";
  const input: ManualGrantPreviewInput | null = targetEmail
    ? {
        target_firebase_uid: targetUser?.firebase_uid,
        target_email: targetEmail,
        operation_type: operation as "extend_current" | "start_from_now",
        plan,
        duration_mode:
          plan === "lifetime" ? ("lifetime" as const) : ("duration" as const),
        duration_value: plan === "lifetime" ? undefined : Number(duration),
        duration_unit: unit,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        reason_code: reasonCode,
        reason_note: note.trim() || undefined,
      }
    : null;
  const runPreview = async () => {
    if (!input || inFlight.current) return;
    inFlight.current = true;
    setPhase("review");
    setError("");
    try {
      const result = await admin.previewManualGrant(input);
      setReviewed({ input, preview: result });
    } catch (reason) {
      setReviewed(null);
      setError(adminMutationError(locale, reason));
    } finally {
      inFlight.current = false;
      setPhase(null);
    }
  };
  const reasonValid = reasonCode !== "other" || note.trim().length >= 3;
  const execute = async () => {
    if (!reviewed || reviewed.preview.blocked || !reasonValid || inFlight.current) return;
    inFlight.current = true;
    setPhase("execute");
    setError("");
    try {
      await admin.executeManualGrant({
        ...reviewed.input,
        reason: reviewed.input.reason_note || "",
        idempotency_key: idempotencyKey,
        preview_hash: reviewed.preview.preview_hash,
      });
      setIdempotencyKey(crypto.randomUUID());
      onChanged();
      onClose();
    } catch (reason) {
      setError(adminMutationError(locale, reason));
    } finally {
      inFlight.current = false;
      setPhase(null);
    }
  };
  return (
    <AdminTaskPage
      onBack={() => confirmClose(onClose)}
      busy={phase === "execute"}
      title={copy(locale, "Grant subscription", "منح اشتراك")}
      description={account ? undefined : copy(
        locale,
        "Choose an existing user or enter the email that will register later.",
        "اختر مستخدمًا حاليًا أو اكتب البريد الذي سيسجل لاحقًا.",
      )}
      backLabel={account ? copy(locale, "Back to account", "العودة للحساب") : copy(locale, "Back to subscriptions", "العودة للاشتراكات")}
      footer={
        <>
          <Button
            onClick={runPreview}
            disabled={!input || !reasonValid || busy}
            loading={phase === "review"}
          >
            {copy(locale, "Review changes", "مراجعة التغييرات")}
          </Button>
          <Button
            variant="primary"
            onClick={execute}
            disabled={!preview || preview.blocked || !reasonValid || busy}
            loading={phase === "execute"}
          >
            {copy(locale, "Confirm grant", "تأكيد المنح")}
          </Button>
        </>
      }
    >
      <div className="stack manual-grant-form">
        {account ? <div className="admin-record-overview__date"><CreditCard size={16} aria-hidden="true" /><div>
          <span className="secondary">{copy(locale, "Account", "الحساب")}</span><strong><bdi>{account.email}</bdi></strong>
        </div></div> : <FormField label={copy(locale, "User", "المستخدم")} htmlFor={fieldId + "-user"}>
          <Input
            id={fieldId + "-user"}
            disabled={busy}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setSelected(null);
              setReviewed(null);
            }}
            placeholder={copy(
              locale,
              "Search by name or email",
              "ابحث بالاسم أو البريد",
            )}
          />
        </FormField>}
        {lookupPending && searchKey.length >= 2 ? <p role="status">{copy(locale, "Finding users…", "جارٍ البحث عن المستخدمين…")}</p> : null}
        {!lookupPending && users.error ? <Alert tone="danger"
          title={copy(locale, "Could not search users.", "تعذّر البحث عن المستخدمين.")}
          action={<Button onClick={users.reload} disabled={busy}>{copy(locale, "Retry", "إعادة المحاولة")}</Button>} /> : null}
        {lookupReady && account && !verifiedAccount ? <Alert tone="danger" title={copy(locale, "This account could not be verified. Close and reopen its details.", "تعذّر التحقق من الحساب. أغلق تفاصيله وافتحها مجددًا.")} /> : null}
        {!account && lookupReady && users.data?.items.length ? (
          <div className="selection-list">
            {users.data.items.map((user) => (
              <button
                type="button"
                key={user.firebase_uid}
                disabled={busy}
                className={
                  selected?.firebase_uid === user.firebase_uid
                    ? "is-selected"
                    : ""
                }
                onClick={() => {
                  setSelected(user);
                  setSearch(user.email);
                  setReviewed(null);
                }}
              >
                <strong>{user.display_name || user.email}</strong>
                <small>
                  {user.email} ·{" "}
                  {statusLabel(user.subscription_presence, locale)}
                </small>
              </button>
            ))}
          </div>
        ) : null}
        {!account && typedEmail && !selected && !exactUser && lookupReady ? (
          <Alert
            title={copy(locale, "Grant after registration", "منح بعد التسجيل")}
            tone="info"
          >
            {copy(
              locale,
              "The subscription will start automatically after this email creates and verifies its account.",
              "سيبدأ الاشتراك تلقائيًا بعد إنشاء الحساب بهذا البريد والتحقق منه.",
            )}
          </Alert>
        ) : null}
        <div className="form-grid">
          <FormField label={copy(locale, "Plan", "الخطة")} htmlFor={fieldId + "-plan"}>
            <Select
              id={fieldId + "-plan"}
              disabled={busy}
              value={plan}
              onChange={(event) => {
                setPlan(event.target.value as typeof plan);
                setReviewed(null);
              }}
            >
              <option value="weekly">{copy(locale, "Weekly", "أسبوعي")}</option>
              <option value="monthly">{copy(locale, "Monthly", "شهري")}</option>
              <option value="annual">{copy(locale, "Annual", "سنوي")}</option>
              <option value="lifetime">
                {copy(locale, "Lifetime", "مدى الحياة")}
              </option>
            </Select>
          </FormField>
          {plan !== "lifetime" ? (
            <>
              <FormField label={copy(locale, "Duration", "المدة")} htmlFor={fieldId + "-duration"}>
                <Input
                  id={fieldId + "-duration"}
                  disabled={busy}
                  type="number"
                  min="1"
                  value={duration}
                  onChange={(event) => {
                    setDuration(event.target.value);
                    setReviewed(null);
                  }}
                />
              </FormField>
              <FormField label={copy(locale, "Unit", "الوحدة")} htmlFor={fieldId + "-unit"}>
                <Select
                  id={fieldId + "-unit"}
                  disabled={busy}
                  value={unit}
                  onChange={(event) => {
                    setUnit(event.target.value as typeof unit);
                    setReviewed(null);
                  }}
                >
                  <option value="days">{copy(locale, "Days", "أيام")}</option>
                  <option value="weeks">
                    {copy(locale, "Weeks", "أسابيع")}
                  </option>
                  <option value="months">
                    {copy(locale, "Months", "أشهر")}
                  </option>
                </Select>
              </FormField>
            </>
          ) : null}
        </div>
        <FormField label={copy(locale, "Reason", "السبب")} htmlFor={fieldId + "-reason"}>
          <Select
            id={fieldId + "-reason"}
            disabled={busy}
            value={reasonCode}
            onChange={(event) => {
              setReasonCode(event.target.value as typeof reasonCode);
              setReviewed(null);
            }}
          >
            <option value="admin_grant">
              {copy(locale, "Administrative grant", "منح إداري")}
            </option>
            <option value="compensation">
              {copy(locale, "Compensation", "تعويض")}
            </option>
            <option value="trial">
              {copy(locale, "Trial", "فترة تجريبية")}
            </option>
            <option value="technical_support">
              {copy(locale, "Technical support", "دعم فني")}
            </option>
            <option value="subscription_replacement">
              {copy(locale, "Subscription replacement", "استبدال اشتراك")}
            </option>
            <option value="other">{copy(locale, "Other", "سبب آخر")}</option>
          </Select>
        </FormField>
        <FormField
          label={copy(locale, "Note", "ملاحظة")}
          htmlFor={fieldId + "-note"}
          required={reasonCode === "other"}
        >
          <Textarea
            id={fieldId + "-note"}
            disabled={busy}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setReviewed(null);
            }}
          />
        </FormField>
        {preview ? (
          <Alert
            title={copy(locale, "Change preview", "معاينة التغيير")}
            tone={preview.blocked ? "danger" : "info"}
          >
            {!preview.blocked && !preview.pending_registration ? <p>{copy(locale, "Plan after this change", "الخطة بعد التغيير")}: {statusLabel(preview.proposed_state.plan_intent, locale)}</p> : null}
            {copy(
              locale,
              preview.pending_registration
                ? "The grant will activate after account registration and email verification."
                : `Result: ${preview.proposed_state.resulting_entitlement}; expiry: ${date(preview.proposed_state.expires_at, locale)}`,
              preview.pending_registration
                ? "سيُفعّل المنح بعد إنشاء الحساب والتحقق من البريد."
                : `النتيجة: ${statusLabel(preview.proposed_state.resulting_entitlement, locale)}؛ الانتهاء: ${date(preview.proposed_state.expires_at, locale)}`,
            )}
          </Alert>
        ) : null}
        {error ? (
          <Alert
            title={copy(
              locale,
              "Could not complete the request",
              "تعذر إكمال الطلب",
            )}
            tone="danger"
          >
            {error}
          </Alert>
        ) : null}
      </div>
    </AdminTaskPage>
  );
}

function operationLabel(locale: "ar" | "en", intent: OperationIntent) {
  if (intent.kind === "device-unlink") return copy(locale, "Unlink device", "فك ربط الجهاز");
  if (intent.kind === "access") {
    if (intent.scope === "session") return copy(locale, "End session", "إنهاء الجلسة");
    if (intent.scope === "device") return copy(locale, "End access on device", "إنهاء الوصول من الجهاز");
    return copy(locale, "End all sessions", "إنهاء كل الجلسات");
  }
  if (intent.kind === "account") {
    if (intent.action === "suspend") return copy(locale, "Suspend account", "تعليق الحساب");
    if (intent.action === "reactivate") return copy(locale, "Reactivate account", "إعادة تفعيل الحساب");
    return copy(locale, "Mark account for deletion", "وضع علامة حذف على الحساب");
  }
  if (intent.action === "suspend") return copy(locale, "Suspend subscription", "تعليق الاشتراك");
  if (intent.action === "resume") return copy(locale, "Resume subscription", "استئناف الاشتراك");
  if (intent.action === "cancel_at_period_end") return copy(locale, "Cancel at period end", "إلغاء الاشتراك بنهاية الفترة");
  if (intent.action === "cancel_now") return copy(locale, "Cancel subscription now", "إلغاء الاشتراك الآن");
  if (intent.action === "correct_expiry") return copy(locale, "Change expiry date", "تغيير تاريخ الانتهاء");
  return statusLabel(intent.action, locale);
}

function AdminOperationDialog({
  page,
  intent,
  onClose,
  onChanged,
  onRefresh,
}: {
  page: "users" | "subscriptions";
  intent: OperationIntent | null;
  onClose: () => void;
  onChanged: () => void;
  onRefresh: () => void;
}) {
  const { locale } = useExperience();
  const { admin } = useAdapters();
  const fieldId = useId();
  const inFlight = useRef(false);
  const previewRef = useRef<HTMLElement>(null);
  const reloadRef = useRef<HTMLButtonElement>(null);
  const [reasonCode, setReasonCode] =
    useState<AdminOperationReason["reason_code"]>("admin_action");
  const [note, setNote] = useState("");
  const [newExpiry, setNewExpiry] = useState("");
  const [preview, setPreview] = useState<AdminOperationPreview | AdminDeviceResetPreview | null>(null);
  const [phase, setPhase] = useState<"review" | "execute" | null>(null);
  const [error, setError] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const dirty = reasonCode !== "admin_action" || Boolean(note.trim() || newExpiry);
  const recordId = page === "users" && intent && "uid" in intent ? intent.uid : intent?.kind === "subscription" ? intent.subscriptionId : "";
  const confirmClose = useRecordProtection(page, recordId, intent ? phase === "execute" ? "saving" : dirty ? "draft" : null : null);
  const isUnlink = intent?.kind === "device-unlink";
  const needsExpiry = intent?.kind === "subscription" && intent.action === "correct_expiry";
  const noteRequired = isUnlink || reasonCode === "other";
  const noteMissing = noteRequired && note.trim().length < 3;
  const expiryMissing = needsExpiry && !Number.isFinite(Date.parse(newExpiry));
  const reason = { reason_code: reasonCode, reason_note: note.trim() || undefined };
  const expiry = needsExpiry && !expiryMissing ? new Date(newExpiry).toISOString() : undefined;
  const resetReview = () => { setPreview(null); setError(""); };
  useEffect(() => {
    if (phase) return;
    if (needsRefresh) reloadRef.current?.focus();
    else if (preview) previewRef.current?.focus();
  }, [preview, phase, needsRefresh]);

  const review = async () => {
    if (!intent || inFlight.current || needsRefresh || noteMissing || expiryMissing) return;
    inFlight.current = true;
    setPhase("review");
    resetReview();
    try {
      const result =
        intent.kind === "device-unlink" ? await admin.previewDeviceReset(intent.uid, note.trim())
        : intent.kind === "account"
          ? await admin.previewAccountLifecycle(intent.uid, { ...reason, action: intent.action })
          : intent.kind === "access"
            ? await admin.previewAccessRevocation(intent.uid, { ...reason, scope: intent.scope, target_id: intent.targetId })
            : await admin.previewSubscriptionTransition(intent.subscriptionId, { ...reason, action: intent.action, new_expiry: expiry });
      if (!result?.preview_hash) throw new Error("invalid_preview");
      if (intent.kind === "device-unlink" && (!("binding" in result) || result.binding?.id !== intent.bindingId)) {
        throw new Error("preview_changed");
      }
      setPreview(result);
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : "";
      if (isUnlink && ["device_not_found", "preview_changed"].includes(code)) {
        setNeedsRefresh(true);
        setError(copy(locale, "The linked device changed. Reload the account to see its current device.", "تغيّر الجهاز المرتبط. حدّث الحساب لعرض الجهاز الحالي."));
      } else {
        setError(code === "invalid_new_expiry"
          ? copy(locale, "Choose an expiry after the subscription start date.", "اختر تاريخ انتهاء بعد بداية الاشتراك.")
          : adminMutationError(locale, failure));
      }
    } finally {
      inFlight.current = false;
      setPhase(null);
    }
  };

  const execute = async () => {
    if (!intent || !preview || inFlight.current || needsRefresh) return;
    inFlight.current = true;
    setPhase("execute");
    setError("");
    try {
      const confirmation = { ...reason, preview_hash: preview.preview_hash, request_id: crypto.randomUUID() };
      if (intent.kind === "device-unlink") {
        await admin.executeDeviceReset(intent.uid, { reason: note.trim(), preview_hash: confirmation.preview_hash, request_id: confirmation.request_id });
      } else if (intent.kind === "account") {
        await admin.executeAccountLifecycle(intent.uid, { ...confirmation, action: intent.action });
      } else if (intent.kind === "access") {
        await admin.executeAccessRevocation(intent.uid, { ...confirmation, scope: intent.scope, target_id: intent.targetId });
      } else {
        await admin.executeSubscriptionTransition(intent.subscriptionId, { ...confirmation, action: intent.action, new_expiry: expiry });
      }
      onChanged();
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : "";
      setPreview(null);
      setNeedsRefresh(true);
      setError(["preview_changed", "stale_account_state", "stale_subscription_state", "session_not_found", "device_not_found"].includes(code)
        ? copy(locale, "The record changed. Reload it before trying again.", "تغيّر السجل. حدّثه قبل المحاولة مرة أخرى.")
        : copy(locale, "We could not verify the outcome. Reload the record before trying again.", "تعذر التأكد من نتيجة الإجراء. حدّث السجل قبل المحاولة مرة أخرى."));
    } finally {
      inFlight.current = false;
      setPhase(null);
    }
  };

  if (!intent) return null;
  const actionLabel = operationLabel(locale, intent);
  const cancelLabel = copy(locale, "Cancel", "إلغاء");
  const reviewedChange = preview && !("binding" in preview) ? preview : null;
  const destructive = isUnlink || intent.kind === "access" || (intent.kind === "account" && intent.action !== "reactivate")
    || (intent.kind === "subscription" && (intent.action === "cancel_now" || reviewedChange?.sessions_will_be_revoked));
  const currentStatus = reviewedChange?.current_status || reviewedChange?.current?.lifecycle;
  const resultingStatus = reviewedChange?.resulting_status || reviewedChange?.resulting?.lifecycle;
  const target = [reviewedChange?.target?.email, reviewedChange?.target?.display_name, reviewedChange?.target?.firebase_uid]
    .find((value): value is string => typeof value === "string" && Boolean(value));
  const impact = isUnlink
    ? copy(locale, "This unlinks the device from Saturn, ends the account’s desktop sessions and cancels pending device-change requests. No files are deleted. The next eligible desktop sign-in can link a device.", "يفك هذا الإجراء ربط الجهاز بساترن، وينهي جلسات سطح المكتب للحساب ويلغي طلبات تغيير الجهاز المعلّقة. لا يحذف أي ملفات. يمكن ربط جهاز عند تسجيل الدخول التالي إذا كان مسموحًا به.")
    : intent.kind === "access"
    ? intent.scope === "session"
      ? copy(locale, "This ends the selected Saturn session. Other sessions stay signed in.", "ينهي هذا الإجراء جلسة ساترن المحددة فقط. تظل الجلسات الأخرى مفتوحة.")
      : intent.scope === "device"
        ? copy(locale, "This ends Saturn sessions and expires open login requests on the selected device.", "ينهي هذا الإجراء جلسات ساترن وطلبات تسجيل الدخول المفتوحة على الجهاز المحدد.")
        : copy(locale, "This ends the account’s Saturn sessions and expires its open login requests. The account can sign in again if it is active.", "ينهي هذا الإجراء جلسات ساترن وطلبات تسجيل الدخول المفتوحة للحساب. يمكن تسجيل الدخول مجددًا إذا كان الحساب نشطًا.")
    : intent.kind === "account" && intent.action === "mark_pending_deletion"
      ? copy(locale, "This marks the account as pending deletion and ends its Saturn sessions. It does not delete the account or its data.", "يضع هذا الإجراء الحساب في حالة انتظار الحذف وينهي جلسات ساترن. لا يحذف الحساب أو بياناته.")
      : intent.kind === "account" && intent.action === "suspend"
        ? copy(locale, "This blocks new sign-ins and ends the account’s Saturn sessions.", "يمنع هذا الإجراء تسجيل الدخول وينهي جلسات ساترن للحساب.")
        : reviewedChange?.sessions_will_be_revoked
          ? copy(locale, "This ends the account’s Saturn sessions.", "ينهي هذا الإجراء جلسات ساترن للحساب.")
          : null;
  const close = () => { if (!inFlight.current) confirmClose(onClose); };

  return (
    <Modal
      open
      onClose={close}
      closeDisabled={Boolean(phase)}
      title={actionLabel}
      closeLabel={copy(locale, "Close", "إغلاق")}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={Boolean(phase)}>{cancelLabel}</Button>
          {needsRefresh ? (
            <Button ref={reloadRef} variant="primary" onClick={onRefresh}>{copy(locale, "Reload record", "تحديث السجل")}</Button>
          ) : (
            <Button variant={destructive ? "danger" : "primary"} onClick={execute} disabled={!preview} loading={phase === "execute"}>{actionLabel}</Button>
          )}
        </>
      }
    >
      <div className="stack">
        {intent.kind === "device-unlink" ? <dl className="detail-list"><div>
          <dt>{copy(locale, "Linked device", "الجهاز المرتبط")}</dt><dd><bdi>{intent.deviceLabel}</bdi></dd>
        </div></dl> : <FormField label={copy(locale, "Reason", "السبب")} htmlFor={fieldId + "-reason"}>
          <Select id={fieldId + "-reason"} value={reasonCode} disabled={Boolean(phase) || needsRefresh}
            onChange={(event) => { setReasonCode(event.target.value as AdminOperationReason["reason_code"]); resetReview(); }}>
            {["admin_action", "customer_request", "security_review", "technical_support", "billing_correction", "subscription_recovery", "policy_enforcement", "other"].map((value) => (
              <option key={value} value={value}>{statusLabel(value, locale)}</option>
            ))}
          </Select>
        </FormField>}
        <FormField label={isUnlink ? copy(locale, "Reason for unlinking", "سبب فك الربط") : copy(locale, "Note", "ملاحظة")} htmlFor={fieldId + "-note"} required={noteRequired}>
          <Textarea id={fieldId + "-note"} value={note} maxLength={1000} required={noteRequired}
            aria-describedby={noteRequired ? fieldId + "-note-hint" : undefined}
            disabled={Boolean(phase) || needsRefresh} onChange={(event) => { setNote(event.target.value); resetReview(); }} />
          {noteRequired ? <p id={fieldId + "-note-hint"} className="ui-field__helper">
            {copy(locale, "Enter at least 3 characters.", "أدخل 3 أحرف على الأقل.")}
          </p> : null}
        </FormField>
        {needsExpiry ? (
          <FormField label={copy(locale, "New expiry date", "تاريخ الانتهاء الجديد")} htmlFor={fieldId + "-expiry"} required>
            <Input id={fieldId + "-expiry"} type="datetime-local" value={newExpiry} required disabled={Boolean(phase) || needsRefresh}
              onChange={(event) => { setNewExpiry(event.target.value); resetReview(); }} />
          </FormField>
        ) : null}
        {!needsRefresh ? <div className="cluster"><Button onClick={review} disabled={Boolean(preview) || noteMissing || expiryMissing} loading={phase === "review"}>
          {copy(locale, "Review change", "مراجعة التغيير")}
        </Button></div> : null}
        {preview ? (
          <section ref={previewRef} tabIndex={-1} className="stack" aria-label={copy(locale, "Change preview", "معاينة التغيير")}>
            {target || currentStatus || resultingStatus ? <dl className="detail-list">
              {target ? <div><dt>{copy(locale, "Account", "الحساب")}</dt><dd><bdi>{target}</bdi></dd></div> : null}
              {currentStatus ? <div><dt>{copy(locale, "Current status", "الحالة الحالية")}</dt><dd>{statusLabel(currentStatus, locale)}</dd></div> : null}
              {resultingStatus ? <div><dt>{copy(locale, "New status", "الحالة الجديدة")}</dt><dd>{statusLabel(resultingStatus, locale)}</dd></div> : null}
              {needsExpiry && reviewedChange?.resulting?.expires_at ? <div><dt>{copy(locale, "New expiry", "تاريخ الانتهاء الجديد")}</dt><dd>{date(reviewedChange.resulting.expires_at, locale)}</dd></div> : null}
            </dl> : null}
            {impact ? <p>{impact}</p> : null}
          </section>
        ) : null}
        {error ? <Alert tone="danger" title={error} /> : null}
      </div>
    </Modal>
  );
}
