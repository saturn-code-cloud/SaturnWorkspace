import { Activity, Bug, CheckCircle2, RefreshCcw, ShieldAlert, Users } from "lucide-react";
import type { ReactNode } from "react";
import { useAdapters } from "../../adapters/AdapterProvider";
import { useExperience } from "../../app/ExperienceProvider";
import type { Navigate } from "../../app/routes";
import { Button } from "../../components/ui/Button";
import { RouteLink } from "../../components/ui/RouteLink";
import { Card, PageHeader, SectionHeader, StatCard } from "../../components/ui/DataDisplay";
import { AdminDataTable } from './AdminDataTable';
import { Alert, Badge, EmptyState, SkeletonStack } from "../../components/ui/Feedback";
import { useAsyncData } from "../../hooks/useAsyncData";
import { auditActionLabel, copy, date } from "./adminPageSupport";
import { deviceRequestsRoute, diagnosticsRoute, readSupportQueueState, supportQueueRoute } from "./adminRouteState";

const supportQueue = readSupportQueueState("?scope=waiting");
const queueLimit = 5;

function QueuePreview<T>({ rows, loading, emptyTitle, rowKey, render }: {
  rows: T[]; loading: boolean; emptyTitle: string; rowKey: (row: T) => string; render: (row: T) => ReactNode;
}) {
  if (loading) return <div className="admin-overview__queue-loading" aria-busy="true"><SkeletonStack rows={queueLimit} /></div>;
  if (!rows.length) return <EmptyState variant="section" title={emptyTitle} body="" />;
  return <ul role="list" className="admin-overview__queue-items">
    {rows.map((row) => <li key={rowKey(row)}>{render(row)}</li>)}
  </ul>;
}

export function AdminOverview({ navigate, canReadDeviceRequests, canReadDiagnostics, canReadAudit }: { navigate: Navigate; canReadDeviceRequests: boolean; canReadDiagnostics: boolean; canReadAudit: boolean }) {
  const { locale, formatNumber } = useExperience();
  const { admin } = useAdapters();
  const resource = useAsyncData((signal) => admin.getDashboard(signal), [admin], JSON.stringify([canReadDiagnostics, canReadAudit]));
  const deviceRequests = useAsyncData((signal) => canReadDeviceRequests
    ? admin.listDeviceChangeRequests({ status: "pending", limit: queueLimit }, signal) : Promise.resolve(null), [admin], String(canReadDeviceRequests));
  const supportThreads = useAsyncData((signal) => admin.listSupportInbox({ scope: "waiting", limit: queueLimit }, signal), [admin]);
  const triage = useAsyncData((signal) => canReadDiagnostics
    ? admin.getDiagnosticTriage({ summary: true }, signal) : Promise.resolve(null), [admin], String(canReadDiagnostics));
  const deviceRows = deviceRequests.data?.items || [];
  const supportRows = supportThreads.data?.threads || [];
  const kpis = resource.error ? null : resource.data?.kpis;
  const displayCount = (value: number | null | undefined) => value == null ? "—" : formatNumber(value);
  const activity = resource.data?.recentActivity.slice(0, 5) || [];
  const degradedResources = resource.data?.degradedResources || [];
  const activityUnavailable = degradedResources.includes("activity") || Boolean(resource.error);
  const busy = [resource, supportThreads, ...(canReadDeviceRequests ? [deviceRequests] : []), ...(canReadDiagnostics ? [triage] : [])]
    .some((source) => source.loading || source.refreshing);
  const pending = (source: { loading: boolean; refreshing: boolean }) => source.loading || source.refreshing;
  const retry = (reload: () => void, loading: boolean) => <Button size="sm" loading={loading} onClick={reload}>{copy(locale, "Retry", "إعادة المحاولة")}</Button>;
  const queueNote = (count: number, hasMore: boolean | undefined) => hasMore ? <p className="admin-overview__queue-note">
    {copy(locale, `Showing the first ${formatNumber(count)} results`, `عرض أول ${formatNumber(count)} نتائج`)}
  </p> : null;
  const refresh = () => {
    resource.reload();
    if (canReadDeviceRequests) deviceRequests.reload();
    supportThreads.reload();
    if (canReadDiagnostics) triage.reload();
  };
  const deviceLabel = copy(locale, "Pending device requests", "طلبات تغيير الجهاز المعلّقة");
  const supportLabel = copy(locale, "Support awaiting a reply", "تذاكر بانتظار رد الدعم");
  const allRequests = copy(locale, "View requests", "عرض الطلبات");
  const allTickets = copy(locale, "Open inbox", "فتح صندوق الدعم");
  return (
    <div className="stack admin-overview">
      <PageHeader
        title={copy(locale, "Overview", "نظرة عامة")}
        actions={
          <Button
            onClick={refresh}
            loading={busy}
            leadingIcon={<RefreshCcw size={15} aria-hidden="true" />}
          >
            {copy(locale, "Refresh", "تحديث")}
          </Button>
        }
      />
      <div className="admin-overview__work">
        {canReadDeviceRequests ? <Card padding="none" className="admin-overview__queue">
          <SectionHeader title={deviceLabel}
            action={<RouteLink className="ui-button ui-button--secondary ui-button--sm" route={deviceRequestsRoute()} navigate={navigate}>{allRequests}</RouteLink>}
          />
          {deviceRequests.error ? <Alert tone="warning" title={deviceRows.length
            ? copy(locale, "Could not refresh device requests. Showing the last results.", "تعذّر تحديث طلبات تغيير الجهاز. دي آخر نتائج متاحة.")
            : copy(locale, "Could not load device requests", "تعذّر تحميل طلبات تغيير الجهاز")}
            action={retry(deviceRequests.reload, pending(deviceRequests))} /> : null}
          {!deviceRequests.error || deviceRows.length ? (
            <QueuePreview rows={deviceRows} loading={deviceRequests.loading} rowKey={(row) => row.id}
              emptyTitle={copy(locale, "No pending device requests", "لا توجد طلبات معلّقة")}
              render={(row) => <RouteLink className="admin-overview__queue-row" navigate={navigate} route={deviceRequestsRoute("pending", 1, row.id)}>
                <span className="admin-overview__record">
                  <strong><bdi>{row.account?.display_name || row.account?.normalized_email || row.firebase_uid}</bdi></strong>
                  <small className="secondary"><bdi>{row.device_name || copy(locale, "Desktop device", "جهاز سطح مكتب")}</bdi></small>
                </span>
                <small className="secondary">{date(row.requested_at, locale)}</small>
              </RouteLink>}
            />
          ) : null}
          {queueNote(deviceRows.length, deviceRequests.data?.has_more)}
        </Card> : null}
        <Card padding="none" className="admin-overview__queue">
          <SectionHeader title={supportLabel}
            action={<RouteLink className="ui-button ui-button--secondary ui-button--sm" route={supportQueueRoute(supportQueue)} navigate={navigate}>{allTickets}</RouteLink>}
          />
          {supportThreads.error ? <Alert tone="warning" title={supportRows.length
            ? copy(locale, "Could not refresh tickets. Showing the last results.", "تعذّر تحديث تذاكر الدعم. دي آخر نتائج متاحة.")
            : copy(locale, "Could not load support tickets", "تعذّر تحميل تذاكر الدعم")}
            action={retry(supportThreads.reload, pending(supportThreads))} /> : null}
          {!supportThreads.error || supportRows.length ? (
            <QueuePreview rows={supportRows} loading={supportThreads.loading} rowKey={(row) => row.id}
              emptyTitle={copy(locale, "No tickets awaiting support", "لا توجد تذاكر بانتظار رد الدعم")}
              render={(row) => <RouteLink className="admin-overview__queue-row" navigate={navigate} route={supportQueueRoute(supportQueue, row.id)}>
                <span className="admin-overview__record">
                  <strong><bdi>{row.subject || copy(locale, "Untitled ticket", "تذكرة بلا عنوان")}</bdi></strong>
                  <small className="secondary">{date(row.last_customer_reply_at || row.created_at, locale)}</small>
                </span>
                <Badge tone={row.priority === "urgent" ? "danger" : row.priority === "high" ? "warning" : "neutral"}>
                  {row.priority === "urgent" ? copy(locale, "Urgent", "عاجلة") : row.priority === "high" ? copy(locale, "High", "مرتفعة") : row.priority === "low" ? copy(locale, "Low", "منخفضة") : copy(locale, "Normal", "عادية")}
                </Badge>
              </RouteLink>}
            />
          ) : null}
          {queueNote(supportRows.length, supportThreads.data?.has_more)}
        </Card>
      </div>
      {canReadDiagnostics ? <Card padding="none" className="admin-overview__queue">
        <SectionHeader title={copy(locale, "Diagnostics", "التشخيصات")} />
        <div className="admin-overview__metrics" aria-busy={pending(triage) || pending(resource)}>
          <RouteLink className="admin-metric-link" route={diagnosticsRoute({ tab: "groups", status: "attention", asOf: triage.error ? undefined : triage.data?.window.as_of })} navigate={navigate}>
            <StatCard label={copy(locale, "Error groups to review", "مجموعات أخطاء تحتاج متابعة")}
              value={displayCount(triage.error ? null : triage.data?.counts.attention)}
              detail={triage.loading ? copy(locale, "Loading diagnostics…", "جارٍ تحميل التشخيصات…")
                : !triage.error && triage.data ? copy(locale, `From the latest ${formatNumber(triage.data.window.scanned_reports)} reports`, `من آخر ${formatNumber(triage.data.window.scanned_reports)} تقرير`)
                  : copy(locale, "Count unavailable", "العدد غير متاح")}
              icon={<Bug size={17} aria-hidden="true" />} />
          </RouteLink>
          <RouteLink className="admin-metric-link" route={diagnosticsRoute({ tab: "tamper" })} navigate={navigate}>
            <StatCard label={copy(locale, "Unresolved tamper alerts", "تنبيهات العبث التي لم تُحلّ")}
              value={displayCount(kpis?.active_tampering_alerts)}
              detail={resource.loading ? copy(locale, "Loading alerts…", "جارٍ تحميل التنبيهات…")
                : kpis?.active_tampering_alerts == null ? copy(locale, "Count unavailable", "العدد غير متاح") : undefined}
              icon={<ShieldAlert size={17} aria-hidden="true" />} />
          </RouteLink>
        </div>
        {triage.error ? <Alert tone="warning" title={copy(locale, "Could not load error group counts", "تعذّر تحميل عدد مجموعات الأخطاء")}
          action={retry(triage.reload, pending(triage))} /> : null}
        {!resource.error && degradedResources.includes("tamper") ? <Alert tone="warning"
          title={copy(locale, "Could not load the tamper alert count", "تعذّر تحميل عدد تنبيهات العبث")}
          action={retry(resource.reload, pending(resource))} /> : null}
      </Card> : null}
      <Card padding="none" className="admin-overview__queue">
      <SectionHeader title={copy(locale, "Accounts and access", "الحسابات والوصول")} />
      {resource.error || degradedResources.some((source) => ["profiles", "subscriptions", "sessions"].includes(source)) ? (
        <Alert title={copy(locale, "Some counts could not be loaded", "تعذّر تحميل بعض الأعداد")} tone="warning"
          action={retry(resource.reload, pending(resource))} />
      ) : null}
      <div className="admin-overview__metrics" aria-busy={pending(resource)}>
        <StatCard
          label={copy(locale, "Registered Saturn accounts", "حسابات ساترن المسجّلة")}
          value={displayCount(kpis?.total_users)}
          icon={<Users size={17} />}
        />
        <StatCard
          label={copy(locale, "Accounts with subscription access", "حسابات مؤهّلة بالاشتراك")}
          value={displayCount(kpis?.total_active_users)}
          detail={!resource.error && resource.data?.subscriptionCountLimited
            ? copy(locale, "Too many records to verify a total.", "عدد السجلات أكبر من الحد المتاح لحساب الإجمالي.")
            : copy(locale, "Includes accounts in a grace period.", "يشمل الحسابات في فترة السماح.")}
          icon={<CheckCircle2 size={17} />}
        />
        <StatCard
          label={copy(locale, "Valid app sign-ins", "جلسات دخول الأداة السارية")}
          value={displayCount(kpis?.active_sessions)}
          detail={copy(locale, "Unexpired and not revoked. May include users who are offline.", "لم تنتهِ ولم تُلغَ، وقد تشمل مستخدمين غير متصلين.")}
          icon={<Activity size={17} />}
        />
      </div>
      </Card>
      {canReadAudit ? <Card padding="none" className="admin-overview__queue">
        <SectionHeader
          title={copy(locale, "Recent admin activity", "آخر نشاط إداري")}
          action={<RouteLink className="ui-button ui-button--secondary ui-button--sm" route={{ surface: "admin", page: "audit" }} navigate={navigate}>
            {copy(locale, "Open audit log", "فتح سجل التدقيق")}
          </RouteLink>}
        />
        {activityUnavailable ? (
          <Alert tone="warning" title={copy(locale, "Could not load recent activity", "تعذّر تحميل آخر نشاط إداري")}
            action={retry(resource.reload, pending(resource))} />
        ) : <AdminDataTable rows={activity} loading={resource.loading} rowKey={(row) => row.id}
          emptyVariant="section" emptyTitle={copy(locale, "No activity yet", "لا يوجد نشاط إداري بعد")} emptyBody=""
          columns={[
            { key: "action", header: copy(locale, "Action", "الإجراء"), render: (row) => {
              const label = auditActionLabel(row.action, locale);
              const requestId = row.request_id;
              return requestId && /^[\w-]{8,128}$/.test(requestId) ? <RouteLink className="admin-overview__record"
                route={{ surface: "admin", page: "audit", state: "?" + new URLSearchParams({ search: requestId }) }}
                navigate={navigate}><strong>{label}</strong></RouteLink> : label;
            } },
            { key: "actor", header: copy(locale, "Actor", "المنفّذ"), render: (row) => <bdi>{row.actor || "—"}</bdi> },
            { key: "time", header: copy(locale, "Time", "الوقت"), render: (row) => date(row.timestamp, locale) },
          ]} />}
      </Card> : null}
    </div>
  );
}
