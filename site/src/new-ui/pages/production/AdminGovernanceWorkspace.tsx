import { useRef, useState } from "react";
import { Copy, RefreshCcw } from "lucide-react";
import type { AdminAuditLogItem, AdminReadinessCheck } from "../../../api/admin";
import { useAdapters } from "../../adapters/AdapterProvider";
import { useExperience } from "../../app/ExperienceProvider";
import type { Navigate } from "../../app/routes";
import { Button } from "../../components/ui/Button";
import { PageHeader, Pagination, type Column } from "../../components/ui/DataDisplay";
import { AdminDataTable } from './AdminDataTable';
import { Alert, Badge, SkeletonStack } from "../../components/ui/Feedback";
import { SearchInput } from "../../components/ui/FormControls";
import { Accordion, Tabs } from "../../components/ui/Navigation";
import { AdminTaskPage } from "./AdminRecordPage";
import { RouteLink } from "../../components/ui/RouteLink";
import { useAsyncData } from "../../hooks/useAsyncData";
import { useRouteSearchDraft } from "../../hooks/useRouteSearchDraft";
import { AdminInvites } from "./AdminInvites";
import { AdminGlobalPolicy } from "./AdminGlobalPolicy";
import { adminPolicyTab } from "./adminPolicyTabs";
import { AdminPolicyRecords } from "./AdminPolicyRecords";
import { auditActionLabel, copy, date, statusLabel, tone } from "./adminPageSupport";
import { deviceRequestsRoute } from "./adminRouteState";
import { useRecordReturnFocus } from "./useRecordReturnFocus";

const invalidAuditSearch = (value: string) => value.length > 128 || /[\p{Cc}*]/u.test(value);

export function AdminAudit({ navigate, canReadDeviceRequests, routeState }: { navigate: Navigate; canReadDeviceRequests: boolean; routeState?: string }) {
  const { locale } = useExperience();
  const searchInput = useRef<HTMLInputElement>(null);
  const applied = new URLSearchParams(routeState).get("search") || "";
  const search = applied.trim();
  const { value: draft, setValue: setDraft } = useRouteSearchDraft(applied, applied);
  const [refreshKey, setRefreshKey] = useState(0);
  const [inspection, setInspection] = useState({ search: applied, open: false });
  if (inspection.search !== applied) setInspection({ search: applied, open: false });
  const inspecting = inspection.search === applied && inspection.open;
  const setInspecting = (open: boolean) => setInspection({ search: applied, open });
  const invalid = invalidAuditSearch(draft);
  const apply = (value: string) => {
    if (invalidAuditSearch(value)) return;
    setInspecting(false);
    const next = value.trim();
    if (next === search && !invalidAuditSearch(applied)) setRefreshKey((key) => key + 1);
    else navigate({ surface: "admin", page: "audit", state: next ? "?" + new URLSearchParams({ search: next }) : undefined }, { preserveScroll: true });
  };
  return <div className="stack">
    {!inspecting ? <>
    <PageHeader title={copy(locale, "Audit log", "سجل التدقيق")} />
    <form className="ui-table-toolbar" role="search" onSubmit={(event) => {
      event.preventDefault();
      if (!invalid) apply(draft);
    }}>
      <SearchInput ref={searchInput} value={draft} maxLength={128} aria-invalid={invalid}
        aria-describedby={invalid ? "audit-search-error" : undefined}
        label={copy(locale, "Search by actor, action, target, or request ID", "البحث بالمنفّذ أو الإجراء أو الهدف أو رقم الطلب")}
        placeholder={copy(locale, "Actor, action, target, or request ID", "المنفّذ، الإجراء، الهدف أو رقم الطلب")}
        onChange={(event) => setDraft(event.target.value)} />
      <Button type="submit" disabled={invalid}>{copy(locale, "Search", "بحث")}</Button>
      {search || draft ? <Button type="button" variant="ghost" onClick={() => {
        setDraft("");
        if (applied) apply("");
        searchInput.current?.focus();
      }}>{copy(locale, "Clear search", "مسح البحث")}</Button> : null}
    </form>
    {invalid ? <p id="audit-search-error" className="secondary">{copy(locale, "Enter up to 128 characters without asterisks or control characters.", "اكتب حتى 128 حرفًا من دون نجوم أو رموز تحكّم.")}</p> : null}
    </> : null}
    {!invalidAuditSearch(applied) ? <AuditResults key={JSON.stringify([applied, refreshKey])} search={search} navigate={navigate} canReadDeviceRequests={canReadDeviceRequests}
      onInspect={setInspecting}
      onSearchRequest={(requestId) => {
        setDraft(requestId);
        apply(requestId);
        requestAnimationFrame(() => searchInput.current?.focus());
      }} /> : null}
  </div>;
}

function AuditResults({ search, navigate, canReadDeviceRequests, onSearchRequest, onInspect }: {
  search: string; navigate: Navigate; canReadDeviceRequests: boolean; onSearchRequest: (requestId: string) => void;
  onInspect: (value: boolean) => void;
}) {
  const { locale } = useExperience();
  const { admin } = useAdapters();
  const [trail, setTrail] = useState<string[]>([""]);
  const [selected, setSelected] = useState<AdminAuditLogItem | null>(null);
  const listRoot = useRef<HTMLDivElement>(null);
  const cursor = trail.at(-1) || "";
  const resource = useAsyncData((signal) => admin.listAuditLog({ search, cursor, limit: 30 }, signal), [admin, search, cursor], cursor);
  const data = resource.data;
  useRecordReturnFocus(selected?.id || "", Boolean(data && !resource.loading), listRoot);
  const columns: Column<AdminAuditLogItem>[] = [
    { key: "time", header: copy(locale, "Time", "الوقت"), render: (row) => date(row.timestamp || row.happened_at || row.at, locale) },
    { key: "actor", header: copy(locale, "Actor", "المنفّذ"), render: (row) => <bdi>{row.actor || row.admin_email || "—"}</bdi> },
    { key: "action", narrow: 'action' as const, header: copy(locale, "Action", "الإجراء"), render: (row) => auditActionLabel(row.action || row.type, locale) },
    { key: "target", header: copy(locale, "Target", "الهدف"), render: (row) => <bdi>{[row.target_type || row.entity, row.target_id || row.entity_id].filter(Boolean).join(" · ") || "—"}</bdi> },
    { key: "outcome", header: copy(locale, "Result", "النتيجة"), render: (row) => row.outcome
      ? <Badge tone={tone(row.outcome)}>{statusLabel(row.outcome, locale)}</Badge>
      : <span className="secondary">{copy(locale, "Not recorded", "غير مسجّلة")}</span> },
    { key: "detail", narrow: 'action' as const, header: copy(locale, "Details", "التفاصيل"), render: (row) => <Button size="sm" variant="ghost" onClick={() => { setSelected(row); onInspect(true); }}>
      {copy(locale, "Details", "التفاصيل")}
    </Button> },
  ];
  if (selected) return <AuditEntry key={selected.id} entry={selected}
    onClose={() => { setSelected(null); onInspect(false); }}
    navigate={navigate} canReadDeviceRequests={canReadDeviceRequests} onSearchRequest={onSearchRequest} />;
  return <div className="stack" ref={listRoot} aria-busy={resource.loading || resource.refreshing}>
    <div className="cluster">
      <Button size="sm" onClick={resource.reload} disabled={resource.loading || resource.refreshing} leadingIcon={<RefreshCcw size={14} aria-hidden="true" />}>
        {copy(locale, "Refresh entries", "تحديث السجل")}
      </Button>
    </div>
    {resource.error ? <Alert tone={data ? "warning" : "danger"} title={data
      ? copy(locale, "Refresh failed. Showing the previous entries.", "تعذّر التحديث. السجلات المعروضة من آخر تحميل.")
      : copy(locale, "Could not load the audit log", "تعذّر تحميل سجل التدقيق")}
      action={<Button size="sm" onClick={resource.reload}>{copy(locale, "Retry", "إعادة المحاولة")}</Button>} /> : null}
    {data || resource.loading ? <AdminDataTable columns={columns} rows={data?.items || []} loading={resource.loading}
      rowKey={(row) => row.id || String(row.timestamp)}
      emptyTitle={search ? copy(locale, "No matching entries", "لا توجد نتائج مطابقة") : copy(locale, "No audit entries", "لا توجد سجلات تدقيق")}
      emptyBody={search ? copy(locale, "Try a different search or clear it to see all entries.", "جرّب كلمة بحث تانية أو امسح البحث لعرض السجل.") : ""} /> : null}
    {(trail.length > 1 || data?.has_more) ? <Pagination page={trail.length} hasNext={data?.has_more ?? false}
      label={copy(locale, "Audit log page", "صفحة سجل التدقيق")} disabled={resource.loading || resource.refreshing}
      previousLabel={copy(locale, "Newer entries", "السجلات الأحدث")} nextLabel={copy(locale, "Older entries", "السجلات الأقدم")}
      onChange={(next) => {
        if (next < trail.length) setTrail((items) => items.slice(0, -1));
        else if (data?.next_cursor) setTrail((items) => [...items, data.next_cursor!]);
      }} /> : null}
  </div>;
}

function AuditEntry({ entry, onClose, navigate, canReadDeviceRequests, onSearchRequest }: {
  entry: AdminAuditLogItem; onClose: () => void; navigate: Navigate; canReadDeviceRequests: boolean;
  onSearchRequest: (requestId: string) => void;
}) {
  const { locale } = useExperience();
  const [copyStatus, setCopyStatus] = useState<"copied" | "failed" | null>(null);
  const requestId = entry.request_id;
  const targetId = entry.target_id || entry.entity_id;
  const targetType = entry.target_type || entry.entity;
  const isDeviceRequest = targetType === "account_device_change_request";
  const deviceRoute = canReadDeviceRequests && isDeviceRequest &&
    targetId && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(targetId)
    ? deviceRequestsRoute("all", 1, targetId) : null;
  return <AdminTaskPage onBack={onClose} title={copy(locale, "Audit entry", "تفاصيل الإجراء")}
    description={date(entry.timestamp || entry.happened_at || entry.at, locale)}
    backLabel={copy(locale, "Back to audit log", "العودة لسجل التدقيق")}>
    <div className="stack">
      <div className="split">
        <h3>{auditActionLabel(entry.action || entry.type, locale)}</h3>
        <Badge tone={tone(entry.outcome)}>{entry.outcome ? statusLabel(entry.outcome, locale) : copy(locale, "Result not recorded", "النتيجة غير مسجّلة")}</Badge>
      </div>
      {deviceRoute ? <RouteLink className="admin-overview__record" route={deviceRoute} navigate={navigate}>
        {copy(locale, "Open device request", "فتح طلب تغيير الجهاز")}
      </RouteLink> : null}
      <dl className="detail-list">
        <div><dt>{copy(locale, "Actor", "المنفّذ")}</dt><dd><bdi>{entry.actor || entry.admin_email || "—"}</bdi></dd></div>
        {entry.actor_role ? <div><dt>{copy(locale, "Role", "الدور")}</dt><dd>{statusLabel(entry.actor_role, locale)}</dd></div> : null}
        {targetType || targetId ? <div><dt>{copy(locale, "Target", "الهدف")}</dt><dd>
          {isDeviceRequest ? <span>{copy(locale, "Device change request", "طلب تغيير الجهاز")} · </span> : targetType ? <bdi>{targetType} · </bdi> : null}
          <bdi>{targetId || "—"}</bdi>
        </dd></div> : null}
        {entry.reason_code ? <div><dt>{copy(locale, "Reason", "السبب")}</dt><dd>{statusLabel(entry.reason_code, locale)}</dd></div> : null}
        {entry.reason_note ? <div><dt>{copy(locale, "Note", "الملاحظة")}</dt><dd>{entry.reason_note}</dd></div> : null}
        {requestId ? <div><dt>{copy(locale, "Request ID", "رقم الطلب")}</dt><dd><bdi>{requestId}</bdi></dd></div> : null}
      </dl>
      <Accordion initiallyOpen={false} items={[{ id: "audit-technical", title: copy(locale, "Technical details", "تفاصيل تقنية"), body: <dl className="detail-list">
          <div><dt>{copy(locale, "Action code", "رمز الإجراء")}</dt><dd><code dir="ltr">{entry.action || entry.type || "—"}</code></dd></div>
        </dl> }]} />
      {requestId ? <div className="cluster">
        <Button size="sm" leadingIcon={<Copy size={14} aria-hidden="true" />} onClick={async () => {
          try { await navigator.clipboard.writeText(requestId); setCopyStatus("copied"); }
          catch { setCopyStatus("failed"); }
        }}>{copy(locale, "Copy request ID", "نسخ رقم الطلب")}</Button>
        {!invalidAuditSearch(requestId) && requestId.trim() ? <Button size="sm" variant="ghost" onClick={() => onSearchRequest(requestId)}>
          {copy(locale, "Search by this request ID", "البحث برقم الطلب ده")}
        </Button> : null}
      </div> : null}
      {copyStatus ? <p role="status" className="secondary">{copyStatus === "copied" ? copy(locale, "Request ID copied", "تم نسخ رقم الطلب")
        : copy(locale, "Could not copy. Select the request ID and copy it manually.", "تعذّر النسخ. حدّد رقم الطلب وانسخه يدويًا.")}</p> : null}
    </div>
  </AdminTaskPage>;
}

export function AdminPolicies({ canManage, owner, routeState, navigate }: { canManage: boolean; owner: string; routeState?: string; navigate: Navigate }) {
  const { locale } = useExperience();
  const params = new URLSearchParams(routeState || '');
  const tab = adminPolicyTab(routeState);
  const [visitedGlobal, setVisitedGlobal] = useState(tab === 'global');
  if (tab === 'global' && !visitedGlobal) setVisitedGlobal(true);
  const setTab = (value: string) => { const next = new URLSearchParams(params); next.set('tab', value); navigate({ surface: 'admin', page: 'policies', state: '?' + next }, { preserveScroll: true }); };
  return <div className="stack">
    <PageHeader title={copy(locale, 'Policies', 'السياسات')} />
    <Tabs ariaLabel={copy(locale, 'Policy sections', 'أقسام السياسات')} active={tab} onChange={setTab} items={[
      { id: 'global', label: copy(locale, 'Global policy', 'السياسة العامة') },
      { id: 'versions', label: copy(locale, 'Disabled versions', 'الإصدارات المعطلة') },
      { id: 'invites', label: copy(locale, 'Invite codes', 'أكواد الدعوة') },
      { id: 'plans', label: copy(locale, 'Plan features', 'خصائص الخطط') },
    ]} >
    {visitedGlobal ? <div hidden={tab !== 'global'}><AdminGlobalPolicy key={`${owner}:${canManage ? 'write' : 'read'}`} canManage={canManage} active={tab === 'global'} /></div> : null}
    {tab === 'invites' ? <AdminInvites key={owner} canManage={canManage} owner={owner} routeState={routeState} navigate={navigate} /> : tab !== 'global' ? <AdminPolicyRecords key={`${owner}:${tab}`} view={tab === 'versions' ? 'versions' : 'plans'} canManage={canManage} routeState={routeState} navigate={navigate} /> : null}
  </Tabs></div>;
}

function readinessCheckContent(check: AdminReadinessCheck, locale: "ar" | "en") {
  const names: Record<string, [string, string]> = {
    account_profiles: ["Account profiles", "ملفات الحسابات"],
    admin_operation_requests: ["Administrative requests", "طلبات الإجراءات الإدارية"],
    admin_crash_group_state: ["Diagnostic group states", "حالات مجموعات التشخيص"],
    policy_worker_binding: ["Policy service binding", "ربط خدمة السياسات"],
    ota_bucket_binding: ["Release storage binding", "ربط تخزين الإصدارات"],
    payment_provider: ["Payment provider", "مزود الدفع"],
    email_auth: ["Authentication email flag", "علم تفعيل بريد المصادقة"],
    layer1: ["Admin sign-in configuration", "إعداد تسجيل الدخول الإداري"],
    role_assignments: ["Admin role assignments", "تعيين أدوار الإدارة"],
    firebase_allowlist: ["Admin account allowlist", "قائمة الحسابات الإدارية المسموح بها"],
  };
  const states: Record<AdminReadinessCheck["status"], [string, string]> = {
    passed: ["Read succeeded", "قراءة ناجحة"], configured: ["Configuration present", "الإعداد موجود"],
    missing: ["Needs configuration", "ينقصه إعداد"], unavailable: ["Check unavailable", "تعذر الفحص"],
    disabled: ["Not enabled", "غير مفعّل"], review: ["Needs review", "يحتاج مراجعة"],
  };
  const reasons: Record<AdminReadinessCheck["reason"], [string, string]> = {
    read_succeeded: ["The table is readable now. No records were changed.", "الجدول متاح للقراءة الآن. لم تُعدّل أي سجلات."],
    schema_missing: ["The table is not available through the Data API. Review its schema and API exposure.", "الجدول غير متاح عبر واجهة البيانات. راجع بنية الجدول وإتاحته للواجهة."],
    read_unavailable: ["The read could not be confirmed. Retry and check the connection and permissions.", "تعذر تأكيد القراءة. أعد الفحص وراجع الاتصال والصلاحيات."],
    not_configured: ["The required configuration is incomplete.", "الإعداد المطلوب غير مكتمل."],
    configuration_present: ["Configuration is present; a live operation was not tested.", "الإعداد موجود؛ لم تُختبر عملية فعلية."],
    flag_enabled: ["The Admin server flag is enabled. No verification email was sent.", "العلم مفعّل في إعدادات خادم الإدارة. لم تُرسل رسالة تحقق."],
    flag_disabled: ["The Admin server flag is disabled. This does not test the email provider.", "العلم غير مفعّل في إعدادات خادم الإدارة. هذا ليس اختبارًا لمزود البريد."],
    role_configuration_missing: ["Role assignments are not configured. Compatibility mode gives allowlisted admins full access. Review the assignments.", "لم تُضبط تعيينات الأدوار. وضع التوافق يمنح الحسابات الإدارية المسموح بها صلاحية المشرف العام. راجع التعيينات."],
    integration_not_active: ["Payments are not active in the product.", "الدفع غير مفعّل في المنتج."],
    configuration_present_disabled: ["Provider configuration is present, but payments are not active in the product.", "إعداد مزود موجود، لكن الدفع غير مفعّل في المنتج."],
  };
  const name = names[check.id] || [check.id, check.id];
  const state = check.reason === "schema_missing" ? ["Table unavailable", "الجدول غير متاح"] : states[check.status];
  const reason = check.group === "database" && check.reason === "not_configured"
    ? ["Database connection configuration is incomplete.", "إعداد الاتصال بقاعدة البيانات غير مكتمل."] : reasons[check.reason];
  const badgeTone = check.status === "passed" ? "success" as const
    : ["missing", "unavailable", "review"].includes(check.status) ? "warning" as const : "neutral" as const;
  return { name: copy(locale, name[0], name[1]), state: copy(locale, state[0], state[1]),
    reason: copy(locale, reason[0], reason[1]), tone: badgeTone };
}

export function AdminReadiness() {
  const { locale } = useExperience();
  const { admin } = useAdapters();
  const resource = useAsyncData((signal) => admin.getReadiness(signal), [admin]);
  const busy = resource.loading || resource.refreshing;
  const affectedChecks = resource.data?.checks.filter((check) => ["missing", "unavailable", "review"].includes(check.status)) || [];
  const sections = [
    { id: "database", title: copy(locale, "Database reads", "فحوص قراءة قاعدة البيانات") },
    { id: "configuration", title: copy(locale, "Service configuration", "إعدادات الخدمات") },
    { id: "security", title: copy(locale, "Admin access configuration", "إعداد وصول الإدارة") },
  ];
  return <div className="stack">
    <PageHeader title={copy(locale, "Readiness", "الجاهزية")}
      description={copy(locale, "Checks table reads and current configuration. This is not continuous service monitoring.", "فحوص قراءة الجداول والإعدادات الحالية؛ لا تقيس توافر الخدمات باستمرار.")}
      actions={<Button onClick={resource.reload} loading={busy} leadingIcon={<RefreshCcw size={15} aria-hidden="true" />}>
        {copy(locale, "Run checks again", "إعادة الفحص")}
      </Button>} />
    {resource.data ? <p className="secondary readiness-checked-at">
      {copy(locale, "Last checked: ", "آخر فحص: ")}<time dateTime={resource.data.generated_at}>{date(resource.data.generated_at, locale)}</time>
    </p> : null}
    {resource.error ? <Alert tone="warning" title={resource.data
      ? copy(locale, "The checks could not be refreshed. Previous results are shown.", "تعذّر إعادة الفحص. المعروض هو نتيجة آخر فحص.")
      : copy(locale, "The checks could not be loaded. Try again.", "تعذر تحميل الفحوص. أعد المحاولة.")} /> : null}
    {resource.loading && !resource.data ? <SkeletonStack rows={8} /> : null}
    {affectedChecks.length ? <Alert tone="warning" title={copy(locale, "Checks that need attention", "فحوص تحتاج متابعة")}>
      <div className="cluster">
        {sections.filter((section) => affectedChecks.some((check) => check.group === section.id)).map((section) =>
          <a key={section.id} href={"#readiness-" + section.id}>{section.title}</a>)}
      </div>
    </Alert> : null}
    {resource.data ? <div className="readiness-sections" aria-busy={busy}>
      {sections.map((section) => <section key={section.id} aria-labelledby={"readiness-" + section.id}>
        <h2 id={"readiness-" + section.id}>{section.title}</h2>
        <dl className="readiness-checks">{resource.data!.checks.filter((check) => check.group === section.id).map((check) => {
          const content = readinessCheckContent(check, locale);
          return <div key={check.id}>
            <dt>{content.name}</dt>
            <dd className="readiness-checks__state"><Badge tone={content.tone}>{content.state}</Badge></dd>
            <dd className="readiness-checks__reason">{content.reason}</dd>
          </div>;
        })}</dl>
      </section>)}
    </div> : null}
  </div>;
}
