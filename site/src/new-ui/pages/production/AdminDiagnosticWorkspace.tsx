import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Copy } from "lucide-react";
import type { AdminCrashGroup, AdminCrashLog, AdminDiagnosticFilters, AdminTamperAlert } from "../../../api/admin";
import { useAdapters } from "../../adapters/AdapterProvider";
import { useExperience } from "../../app/ExperienceProvider";
import { useAdminNavigationProtection } from "../../app/adminNavigationProtection";
import type { AppRoute, Navigate } from "../../app/routes";
import { Button } from "../../components/ui/Button";
import { PageHeader, Pagination, type Column } from "../../components/ui/DataDisplay";
import { AdminDataTable } from './AdminDataTable';
import { Alert, Badge, SkeletonStack } from "../../components/ui/Feedback";
import { FormField, Input, Select, Textarea } from "../../components/ui/FormControls";
import { Tabs } from "../../components/ui/Navigation";
import { Modal } from "../../components/ui/Overlays";
import { DiagnosticCopyControl } from "./DiagnosticCopyControl";
import { DiagnosticFiltersToolbar, type AppliedDiagnosticFilters } from "./DiagnosticFiltersToolbar";
import { collectDiagnosticReports, collectDiagnosticReportsByIds, createDiagnosticBundle, formatDiagnosticReports } from "./diagnosticReportExport";
import { diagnosticsRoute, type DiagnosticGroupStatus, type DiagnosticTab } from "./adminRouteState";
import { adminMutationError, copy, date, statusLabel, tone, useResource } from "./adminPageSupport";

function DiagnosticTriagePanel({ filters, status, asOf, canDecide, inspectingReportId, onStatusChange, onOpenReport, onLatest }: {
  filters: AdminDiagnosticFilters;
  status: DiagnosticGroupStatus;
  asOf?: string;
  canDecide: boolean;
  inspectingReportId?: string;
  onStatusChange: (value: DiagnosticGroupStatus) => void;
  onOpenReport: (id: string) => void;
  onLatest: () => void;
}) {
  const { locale } = useExperience();
  const { admin } = useAdapters();
  const groups = useResource((signal) => admin.getDiagnosticTriage({ ...filters, asOf }, signal), [admin, filters, asOf]);
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<AdminCrashGroup | null>(null);
  const [saved, setSaved] = useState<{ label: string; status: AdminCrashGroup["status"] } | null>(null);
  const matching = (groups.data?.items || []).filter((group) => status === "all" || (status === "attention"
    ? group.status === "open" || group.status === "investigating"
    : group.status === status));
  const pageSize = 15;
  const lastPage = Math.max(1, Math.ceil(matching.length / pageSize));
  const currentPage = Math.min(page, lastPage);
  const columns: Column<AdminCrashGroup>[] = [
    { key: "type", header: copy(locale, "Error", "الخطأ"), render: (row) => <div>
      <strong><bdi>{row.error_type}</bdi></strong>
      {row.message ? <small className="diagnostic-table-message" title={row.message}><bdi>{row.message}</bdi></small> : null}
    </div> },
    { key: "count", header: copy(locale, "Occurrences in sample", "التكرار في العيّنة"), render: (row) => row.count },
    { key: "users", header: copy(locale, "Verified users", "مستخدمون موثّقون"), render: (row) => row.affected_user_count ?? 0 },
    { key: "status", header: copy(locale, "Current status", "الحالة الحالية"), render: (row) => <Badge tone={tone(row.status)}>{statusLabel(row.status, locale)}</Badge> },
    { key: "date", header: copy(locale, "Last seen", "آخر ظهور"), render: (row) => date(row.last_seen_at, locale) },
    { key: "action", narrow: 'action' as const, header: copy(locale, "Actions", "الإجراءات"), render: (row) => <div className="cluster">
      {row.latest_report_id ? <Button size="sm" aria-current={row.latest_report_id === inspectingReportId ? "true" : undefined}
        onClick={() => onOpenReport(row.latest_report_id!)}>{copy(locale, "Latest report", "أحدث تقرير")}</Button> : null}
      {canDecide ? <Button size="sm" variant="ghost" onClick={() => setSelection(row)}>{copy(locale, "Change status", "تغيير الحالة")}</Button> : null}
    </div> },
  ];
  const coverage = groups.error ? undefined : groups.data?.window;
  return <div className={inspectingReportId ? "stack diagnostic-group-queue is-compact" : "stack diagnostic-group-queue"}>
    <div className="cluster">
      <Select aria-label={copy(locale, "Group status", "حالة المجموعة")} value={status} onChange={(event) => {
        setPage(1);
        onStatusChange(event.target.value as DiagnosticGroupStatus);
      }}>
        <option value="all">{copy(locale, "All recent groups", "كل المجموعات الحديثة")}</option>
        <option value="attention">{copy(locale, "Needs review", "تحتاج متابعة")}</option>
        <option value="resolved">{copy(locale, "Resolved", "تم الحل")}</option>
        <option value="ignored">{copy(locale, "Ignored", "تم التجاهل")}</option>
      </Select>
      <Button disabled={groups.loading} onClick={() => {
        setPage(1);
        if (asOf) onLatest(); else groups.reload();
      }}>{copy(locale, "Refresh latest groups", "تحديث أحدث المجموعات")}</Button>
    </div>
    {coverage && groups.data ? <p className="secondary" aria-live="polite">
      {copy(locale,
        `${groups.data.counts.attention} need review out of ${groups.data.counts.recent} groups. Based on ${coverage.scanned_reports} recent reports through ${date(coverage.as_of, locale)}.`,
        `${groups.data.counts.attention} تحتاج متابعة من أصل ${groups.data.counts.recent} مجموعة. الحساب من ${coverage.scanned_reports} تقريرًا حديثًا حتى ${date(coverage.as_of, locale)}.`)}
      {coverage.has_older ? " " + copy(locale, "Older reports are available under All reports.", "التقارير الأقدم موجودة في «كل التقارير».") : null}
    </p> : null}
    {groups.error ? <Alert tone="danger" title={copy(locale, "Could not load diagnostic groups", "تعذر تحميل مجموعات التشخيص")}>
      <Button size="sm" onClick={groups.reload}>{copy(locale, "Retry", "إعادة المحاولة")}</Button>
    </Alert> : <AdminDataTable comparison columns={inspectingReportId ? columns.filter((column) => !["users", "date"].includes(column.key)) : columns}
      rows={matching.slice((currentPage - 1) * pageSize, currentPage * pageSize)} rowKey={(row) => row.fingerprint}
      loading={groups.loading} emptyTitle={copy(locale, "No matching groups in this sample", "لا توجد مجموعات مطابقة في العيّنة")} emptyBody="" />}
    {saved ? <Alert tone="success" title={copy(locale, "Group updated", "تم تحديث المجموعة")}>
      <bdi>{saved.label}</bdi>{" · "}{statusLabel(saved.status, locale)}
    </Alert> : null}
    {!groups.error && lastPage > 1 ? <Pagination page={currentPage} pages={lastPage} disabled={groups.loading}
      label={copy(locale, "Group page", "صفحة المجموعات")} previousLabel={copy(locale, "Previous", "السابق")} nextLabel={copy(locale, "Next", "التالي")} onChange={setPage} /> : null}
    <CrashGroupStateDialog key={selection?.fingerprint || "crash-group:closed"} group={selection} asOf={asOf}
      onClose={() => setSelection(null)} onChanged={(updated) => { setSaved(updated); setSelection(null); groups.reload(); }} />
  </div>;
}

export function AdminDiagnostics({ routeState, navigate, canDecide }: { routeState?: string; navigate: Navigate; canDecide: boolean }) {
  const { locale } = useExperience();
  const params = new URLSearchParams(routeState);
  const tab = (["groups", "occurrences", "warnings", "tamper"] as const).find((value) => value === params.get("tab")) || "occurrences";
  const status = (["all", "attention", "resolved", "ignored"] as const).find((value) => value === params.get("status")) || "all";
  const asOf = params.get("as_of") || undefined;
  const reportId = params.get("report") || undefined;
  const [filters, setFilters] = useState<AppliedDiagnosticFilters>({});
  const [filterVersion, setFilterVersion] = useState(0);
  const reportTrigger = useRef<HTMLElement | null>(null);
  const queue = useRef<HTMLDivElement>(null);
  const currentView = { tab, status, asOf };
  const openReport = (id: string) => {
    if (id === reportId) return;
    reportTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    navigate(diagnosticsRoute({ ...currentView, reportId: id }), { preserveScroll: true, replace: Boolean(reportId) });
  };
  const closeReport = () => {
    navigate(diagnosticsRoute(currentView), { preserveScroll: true, replace: true });
    window.requestAnimationFrame(() => (reportTrigger.current?.isConnected ? reportTrigger.current : queue.current)?.focus());
  };
  return (
    <div className="stack">
      <PageHeader title={copy(locale, "Diagnostics", "التشخيصات")} />
      <div className={reportId ? "diagnostic-workbench is-inspecting" : "diagnostic-workbench"}>
      <div className="diagnostic-workbench__queue stack" ref={queue} tabIndex={-1}>
      <Tabs
        ariaLabel={copy(locale, "Diagnostics sections", "أقسام التشخيص")}
        active={tab}
        onChange={(value) => navigate(diagnosticsRoute({ tab: value as DiagnosticTab }), { preserveScroll: true })}
        items={[
          {
            id: "groups",
            label: copy(locale, "Crash groups", "مجموعات الأعطال"),
          },
          { id: "occurrences", label: copy(locale, "All reports", "كل التقارير") },
          {
            id: "warnings",
            label: copy(locale, "Operational warnings", "تنبيهات التشغيل"),
          },
          {
            id: "tamper",
            label: copy(locale, "Tamper alerts", "تنبيهات العبث"),
          },
        ]}
      >
      {tab !== "tamper" ? <DiagnosticFiltersToolbar applied={filters} onApply={(next) => {
        setFilters(next);
        setFilterVersion((value) => value + 1);
        if (reportId) navigate(diagnosticsRoute(currentView), { preserveScroll: true, replace: true });
      }} /> : null}
      {tab === "groups" ? (
        <DiagnosticTriagePanel key={`${filterVersion}:${asOf || "latest"}`} filters={filters} asOf={asOf} status={status} canDecide={canDecide} inspectingReportId={reportId}
          onStatusChange={(value) => navigate(diagnosticsRoute({ tab, status: value, asOf }), { preserveScroll: true })}
          onOpenReport={openReport}
          onLatest={() => navigate(diagnosticsRoute({ tab, status }), { preserveScroll: true, replace: true })} />
      ) : tab === "tamper" ? (
        <TamperAlertsPanel canDecide={canDecide} />
      ) : (
        <DiagnosticReportHistory key={`${tab}:${filterVersion}`} filters={{ ...filters, classification: tab === "warnings" ? "warning" : "all" }}
          onOpenReport={openReport} inspectingReportId={reportId} />
      )}
      </Tabs></div>
      {reportId ? <DiagnosticReportDialog key={reportId} reportId={reportId} onClose={closeReport} presentation="inspector" /> : null}
      </div>
    </div>
  );
}

export function TamperAlertsPanel({ userId, canDecide }: { userId?: string; canDecide: boolean }) {
  const { locale } = useExperience();
  const { admin } = useAdapters();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AdminTamperAlert | null>(null);
  const alerts = useResource((signal) => admin.listTamperAlerts({ user: userId, resolved: false, page, limit: 20 }, signal), [admin, userId, page]);
  const data = alerts.data?.page === page && !alerts.error ? alerts.data : null;
  const columns: Column<AdminTamperAlert>[] = [
    { key: "severity", header: copy(locale, "Severity", "الخطورة"), render: (row) => <Badge tone={tone(row.severity)}>{statusLabel(row.severity, locale)}</Badge> },
    { key: "reason", header: copy(locale, "Summary", "الملخص"), render: (row) => row.reason },
    { key: "device", header: copy(locale, "Device reference", "مرجع الجهاز"), render: (row) => <bdi>{row.device_key || "—"}</bdi> },
    { key: "date", header: copy(locale, "Time", "الوقت"), render: (row) => date(row.happened_at, locale) },
  ];
  if (canDecide) columns.push({ key: "action", narrow: 'action' as const, header: copy(locale, "Action", "الإجراء"), render: (row) => <Button size="sm" onClick={() => setSelected(row)}>
    {copy(locale, "Resolve", "حل")}
  </Button> });
  return <div className="stack" aria-busy={alerts.loading}>
    <div className="cluster"><Button size="sm" disabled={alerts.loading} onClick={alerts.reload}>
      {alerts.error ? copy(locale, "Retry", "إعادة المحاولة") : copy(locale, "Refresh", "تحديث")}
    </Button></div>
    {alerts.error ? <Alert tone="danger" title={copy(locale, "Could not load tamper alerts", "تعذر تحميل تنبيهات العبث")} />
      : <AdminDataTable columns={columns} rows={data?.items || []} loading={alerts.loading || !data} rowKey={(row) => row.id}
        emptyTitle={userId
          ? copy(locale, "No open tamper alerts linked to this account", "لا توجد تنبيهات عبث مفتوحة مرتبطة بهذا الحساب")
          : copy(locale, "No open tamper alerts", "لا توجد تنبيهات عبث مفتوحة")} emptyBody="" />}
    {page > 1 || data?.has_more ? <Pagination page={page} hasNext={data?.has_more ?? false} disabled={alerts.loading}
      label={copy(locale, "Alerts page", "صفحة التنبيهات")} previousLabel={copy(locale, "Previous", "السابق")} nextLabel={copy(locale, "Next", "التالي")} onChange={setPage} /> : null}
    <TamperResolveDialog key={selected?.id || "tamper:closed"} alert={selected} userId={userId} onClose={() => setSelected(null)}
      onChanged={() => { setSelected(null); if (page === 1) alerts.reload(); else setPage(1); }} />
  </div>;
}

export function DiagnosticReportHistory({ filters, onOpenReport, inspectingReportId }: { filters: AdminDiagnosticFilters; onOpenReport?: (id: string) => void; inspectingReportId?: string }) {
  const { locale } = useExperience();
  const { admin } = useAdapters();
  const [cursors, setCursors] = useState([""]);
  const [localReportId, setLocalReportId] = useState<string | null>(null);
  const openReport = onOpenReport || setLocalReportId;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [copyingSelected, setCopyingSelected] = useState(false);
  const [copySelectedStatus, setCopySelectedStatus] = useState<"" | "success" | "error">("");
  const copySelectedAbort = useRef<AbortController | null>(null);
  useEffect(() => () => copySelectedAbort.current?.abort(), []);
  const reports = useResource(
    (signal) => admin.listCrashLogs({ ...filters, cursor: cursors.at(-1) }, signal),
    [admin, filters.user, filters.search, filters.classification, filters.attribution, cursors],
  );
  const columns: Column<AdminCrashLog>[] = [
    { key: "report", header: copy(locale, "Report", "التقرير"), render: (row) => <div className="diagnostic-queue-row">
      <button type="button" className="diagnostic-queue-row__open" aria-current={inspectingReportId === row.id ? "true" : undefined}
        onClick={() => openReport(row.id)}><bdi>{row.message || row.error_type}</bdi></button>
      <small className="secondary"><bdi>{row.error_type}</bdi>{row.component ? <span className="diagnostic-queue-row__compact-source">
        {" · "}<bdi>{row.component}</bdi>{row.app_version ? <> · <bdi>{row.app_version}</bdi></> : null}
      </span> : null}</small>
    </div> },
    ...(!inspectingReportId ? [
      { key: "user", header: copy(locale, "Saturn user", "مستخدم Saturn"), render: (row: AdminCrashLog) =>
        <bdi>{row.operator?.email || row.operator?.display_name || row.operator?.firebase_uid || copy(locale, "Unattributed", "غير منسوب")}</bdi> },
      { key: "source", header: copy(locale, "Source / version", "المصدر والإصدار"), render: (row: AdminCrashLog) => <div className="diagnostic-queue-row">
        <bdi>{row.component || "—"}</bdi>{row.app_version ? <small className="secondary"><bdi>{row.app_version}</bdi></small> : null}
      </div> },
    ] : []),
    { key: "date", header: copy(locale, "Last seen", "آخر ظهور"), render: (row) => <div className="diagnostic-queue-row">
      <bdi>{date(row.last_happened_at || row.happened_at, locale)}</bdi>
      {(row.occurrence_count || 1) > 1 ? <small className="secondary">{copy(locale, `Occurrences: ${row.occurrence_count}`, `التكرار: ${row.occurrence_count}`)}</small> : null}
    </div> },
  ];
  const copySelectedReports = async () => {
    if (!selectedIds.size || copyingSelected) return;
    setCopyingSelected(true);
    setCopySelectedStatus("");
    const controller = new AbortController();
    copySelectedAbort.current = controller;
    try {
      const reports = await collectDiagnosticReportsByIds(admin, [...selectedIds], controller.signal);
      await navigator.clipboard.writeText(formatDiagnosticReports(reports, filters));
      setCopySelectedStatus("success");
    } catch {
      if (!controller.signal.aborted) setCopySelectedStatus("error");
    } finally {
      if (copySelectedAbort.current === controller) copySelectedAbort.current = null;
      if (!controller.signal.aborted) setCopyingSelected(false);
    }
  };
  return <div className={inspectingReportId ? "stack diagnostic-report-queue is-compact" : "stack diagnostic-report-queue"}>
    {selectedIds.size || copyingSelected ? <div className="cluster diagnostic-queue-selection">
      <Button variant="primary" disabled={!selectedIds.size} loading={copyingSelected} leadingIcon={<Copy size={16} />} onClick={copySelectedReports}>{copy(locale, `Copy selected (${selectedIds.size})`, `نسخ المحدد (${selectedIds.size})`)}</Button>
      <Button size="sm" disabled={copyingSelected} onClick={() => { setSelectedIds(new Set()); setCopySelectedStatus(""); }}>
        {copy(locale, "Clear selection", "إلغاء التحديد")}
      </Button>
    </div> : <div className="cluster">
      <Button disabled={reports.loading} onClick={() => { if (cursors.length > 1) setCursors([""]); else reports.reload(); }}>{copy(locale, "Refresh latest reports", "تحديث أحدث التقارير")}</Button>
      <DiagnosticCopyControl bundle label={copy(locale, "Copy problem summary", "نسخ ملخص المشاكل")} prepare={(signal, progress) => createDiagnosticBundle(admin, filters, signal, progress)} />
      <DiagnosticCopyControl label={copy(locale, "Copy all matching reports (slower)", "نسخ كل التقارير المطابقة (أبطأ)")} prepare={async (signal, progress) => formatDiagnosticReports(await collectDiagnosticReports(admin, filters, signal, progress), filters)} />
    </div>}
    {copySelectedStatus === "success" ? <Alert tone="success" title={copy(locale, "Selected reports copied", "تم نسخ التقارير المحددة")} /> : null}
    {copySelectedStatus === "error" ? <Alert tone="danger" title={copy(locale, "Selected reports could not be copied", "تعذر نسخ التقارير المحددة")} /> : null}
    {reports.error ? <Alert tone="danger" title={copy(locale, "Reports could not be loaded", "تعذر تحميل التقارير")}>
      <Button size="sm" onClick={reports.reload}>{copy(locale, "Retry", "إعادة المحاولة")}</Button>
    </Alert> : <AdminDataTable columns={columns} rows={reports.data?.items || []} loading={reports.loading} rowKey={(row) => row.id}
      selection={{ selectedKeys: selectedIds, onChange: (next) => { if (!copyingSelected) { setSelectedIds(next); setCopySelectedStatus(""); } }, rowLabel: (row) => copy(locale, `Select ${row.message || row.error_type}`, `تحديد ${row.message || row.error_type}`), selectAllLabel: copy(locale, "Select all reports on this page", "تحديد كل تقارير هذه الصفحة") }}
      emptyTitle={filters.search || filters.user || filters.attribution
        ? copy(locale, "No matching reports", "لا توجد تقارير مطابقة")
        : copy(locale, "No reports to show", "لا توجد تقارير للعرض")}
      emptyBody={onOpenReport && (filters.search || filters.user || filters.attribution)
        ? copy(locale, "Try a different search or clear the filters.", "جرّب بحثًا مختلفًا أو امسح الفلاتر.")
        : ""} />}
    {cursors.length > 1 || (!reports.error && reports.data?.has_more) ? <Pagination page={cursors.length}
      pages={cursors.length + (!reports.error && reports.data?.has_more ? 1 : 0)} disabled={reports.loading}
      label={copy(locale, "Report page", "صفحة التقارير")} previousLabel={copy(locale, "Newer", "الأحدث")} nextLabel={copy(locale, "Older", "الأقدم")}
      onChange={(page) => {
        const nextCursor = reports.data?.next_cursor;
        if (page < cursors.length) setCursors((items) => items.slice(0, -1));
        else if (nextCursor) setCursors((items) => [...items, nextCursor]);
      }} /> : null}
    {localReportId ? <DiagnosticReportDialog key={localReportId} reportId={localReportId} onClose={() => setLocalReportId(null)} /> : null}
  </div>;
}

function diagnosticTechnicalFields(value: unknown): [string, string][] {
  const fields: [string, string][] = [];
  const seen = new WeakSet<object>();
  const visit = (item: unknown, path: string, depth: number) => {
    if (fields.length >= 160 || item == null) return;
    if (typeof item !== "object") {
      fields.push([path, String(item).slice(0, 4000)]);
      return;
    }
    if (seen.has(item)) return;
    seen.add(item);
    if (depth >= 8) {
      fields.push([path, "[depth limit]"]);
      return;
    }
    for (const [key, child] of Object.entries(item).slice(0, 80)) {
      visit(child, path ? `${path}.${key}` : key, depth + 1);
    }
  };
  visit(value, "", 0);
  return fields;
}

function DiagnosticEventWindow({ value, title }: { value: unknown; title: string }) {
  const { locale } = useExperience();
  const trace = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const metadata = diagnosticTechnicalFields(Object.fromEntries(Object.entries(trace).filter(([key]) => key !== "events")));
  const events = Array.isArray(trace.events) ? trace.events.filter((event): event is Record<string, unknown> => Boolean(event) && typeof event === "object") : [];
  return <details className="diagnostic-technical-details diagnostic-event-window">
    <summary>{title} ({events.length})</summary>
    <dl className="detail-list" dir="ltr">{metadata.map(([key, fact]) => <div key={key}><dt>{key}</dt><dd>{fact}</dd></div>)}</dl>
    {events.length ? <ol className="stack" dir="ltr">{events.map((event, index) => <li key={String(event.sequence ?? index)}>
      <details className="diagnostic-technical-details">
        <summary><code>{String(event.event || "unknown")}</code> · {String(event.sequence ?? index + 1)} · {typeof event.at_unix_ms === "number" && Number.isFinite(new Date(event.at_unix_ms).valueOf()) ? <time dateTime={new Date(event.at_unix_ms).toISOString()}>{new Date(event.at_unix_ms).toISOString()}</time> : "—"}</summary>
        <dl className="detail-list">{diagnosticTechnicalFields({ correlation: event.correlation, ...event.facts as Record<string, unknown> }).map(([key, fact]) => <div key={key}><dt>{key}</dt><dd>{fact}</dd></div>)}</dl>
      </details>
    </li>)}</ol> : <p className="secondary">{copy(locale, "No events were recorded for this window.", "لم تُسجّل أحداث لهذه الفترة.")}</p>}
  </details>;
}

function followupMessage(status: unknown, locale: 'ar' | 'en') {
  switch (status) {
    case 'linked':
    case 'linked_unattributed':
      return null;
    case 'unavailable':
      return copy(locale, 'Refresh the report to try loading events after the error again.', 'حدّث التقرير لإعادة محاولة تحميل الأحداث بعد الخطأ.');
    case 'identity_unverified':
      return copy(locale, 'The follow-up could not be verified as part of this report.', 'تعذّر التحقق من أن الأحداث اللاحقة تخص هذا التقرير.');
    case 'scheduled':
    case 'not_received':
      return copy(locale, 'No follow-up has been received. Refresh the report to check again.', 'لم تصل الأحداث اللاحقة. حدّث التقرير للتحقق مرة أخرى.');
    default:
      return copy(locale, 'This report has no follow-up trace.', 'لا يحتوي هذا التقرير على تتبّع بعد الخطأ.');
  }
}

function DiagnosticReportDialog({
  reportId,
  onClose,
  presentation = "modal",
}: {
  reportId: string;
  onClose: () => void;
  presentation?: "modal" | "inspector";
}) {
  const { locale } = useExperience();
  const { admin } = useAdapters();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (presentation === "inspector") heading.current?.focus();
  }, [presentation]);
  const [copyStatus, setCopyStatus] = useState<"" | "success" | "error">("");
  const details = useResource(async (signal) => {
    const result = await admin.getCrashLog(reportId, signal);
    if (result?.id?.toLowerCase() !== reportId.toLowerCase()) throw new Error("diagnostics_unavailable");
    return result;
  }, [admin, reportId]);
  const report = details.error ? null : details.data;
  const followupStatus = report?.technical_context?.trace_followup_status;
  const followup = report?.technical_context?.trace_followup;
  const canShowFollowup = Boolean(followup && (followupStatus === 'linked' || followupStatus === 'linked_unattributed'));
  const technicalFields = diagnosticTechnicalFields({
    environment: {
      windows_version: report?.windows_version,
      cpu: report?.cpu,
      gpu: report?.gpu,
      ram_gb: report?.ram_gb,
      tool_channel: report?.tool_channel,
    },
    ...Object.fromEntries(Object.entries(report?.technical_context || {}).filter(([key]) => !key.startsWith("trace"))),
  });
  const copyFullReport = async () => {
    if (!report || details.loading) return;
    setCopyStatus("");
    try {
      await navigator.clipboard.writeText(formatDiagnosticReports([report], {}));
      setCopyStatus("success");
    } catch {
      setCopyStatus("error");
    }
  };
  const title = copy(locale, "Report details", "تفاصيل التقرير");
  const actions = <>
    <Button size="sm" variant="primary" leadingIcon={<Copy size={16} aria-hidden="true" />} disabled={details.loading || !report} onClick={copyFullReport}>
      {copyStatus === "success" ? copy(locale, "Copied", "تم النسخ") : copy(locale, "Copy full report", "نسخ التقرير كاملًا")}
    </Button>
    <Button size="sm" disabled={details.loading} onClick={() => { setCopyStatus(""); details.reload(); }}>{copy(locale, "Refresh report", "تحديث التقرير")}</Button>
  </>;
  const content = <>
      {details.error ? <Alert tone="danger" title={["diagnostic_not_found", "invalid_diagnostic_id"].includes(details.error)
        ? copy(locale, "Report not found or no longer retained", "التقرير غير موجود أو انتهت مدة الاحتفاظ به")
        : copy(locale, "The full report could not be loaded", "تعذر تحميل التقرير الكامل")} /> : null}
      {details.loading && !report ? <SkeletonStack rows={4} /> : null}
      {report ? (
        <div className="stack">
          {copyStatus === "error" ? <Alert tone="danger" title={copy(locale, "The report could not be copied", "تعذر نسخ التقرير")} /> : null}
          <div>
            <h3 className="diagnostic-report-message"><bdi>{report.message || report.error_type}</bdi></h3>
            {report.message && report.message !== report.error_type ? <p className="secondary"><bdi>{report.error_type}</bdi></p> : null}
          </div>
          <div>
            <strong>{copy(locale, "Technical trace", "التتبع الفني")}</strong>
            <pre className="diagnostic-report-trace" dir="ltr">{details.loading ? copy(locale, "Loading technical trace…", "جارٍ تحميل التتبّع الفني…") : report.stack_trace || "—"}</pre>
          </div>
          {followupStatus === "unavailable" ? <Alert tone="warning"
            title={copy(locale, "Could not load events after the error", "تعذر تحميل الأحداث بعد الخطأ")}>
            {followupMessage(followupStatus, locale)}
          </Alert> : null}
          <details className="diagnostic-technical-details">
            <summary>{copy(locale, "Events around the failure", "الأحداث المحيطة بالخطأ")}</summary>
            <DiagnosticEventWindow title={copy(locale, "Before the failure", "قبل الخطأ")} value={report.technical_context?.trace} />
            {canShowFollowup ? <DiagnosticEventWindow title={copy(locale, "After the failure", "بعد الخطأ")} value={followup} />
              : followupStatus !== "unavailable" ? <p className="secondary">{followupMessage(followupStatus, locale) || followupMessage(null, locale)}</p> : null}
          </details>
          <details className="diagnostic-technical-details">
            <summary>{copy(locale, "Report information", "بيانات التقرير")}</summary>
          <dl className="detail-list">
            <div><dt>{copy(locale, "Saturn user", "مستخدم Saturn")}</dt><dd>{report.operator?.email || report.operator?.firebase_uid || copy(locale, "Unattributed", "غير منسوب")}</dd></div>
            <div><dt>{copy(locale, "Attribution", "نسبة التقرير")}</dt><dd>{report.attribution === "verified" ? copy(locale, "Verified session", "جلسة موثّقة") : copy(locale, "No verified user", "لا يوجد مستخدم موثّق")}</dd></div>
            <div><dt>{copy(locale, "Event ID", "معرّف الحدث")}</dt><dd>{report.event_id || report.id}</dd></div>
            <div><dt>{copy(locale, "Occurrences", "التكرار")}</dt><dd>{report.occurrence_count || 1}</dd></div>
            <div><dt>{copy(locale, "Source", "المصدر")}</dt><dd>{report.component || "—"}</dd></div>
            <div><dt>{copy(locale, "Context", "السياق")}</dt><dd>{report.context || "—"}</dd></div>
            <div><dt>{copy(locale, "Version", "الإصدار")}</dt><dd>{report.app_version || "—"}</dd></div>
            <div><dt>{copy(locale, "Time", "الوقت")}</dt><dd>{date(report.happened_at, locale)}</dd></div>
            <div><dt>{copy(locale, "Last seen", "آخر ظهور")}</dt><dd>{date(report.last_happened_at || report.happened_at, locale)}</dd></div>
            <div><dt>{copy(locale, "Device", "الجهاز")}</dt><dd>{report.device_name || report.hwid || "—"}</dd></div>
          </dl>
          </details>
          <details className="diagnostic-technical-details">
            <summary>{copy(locale, "Device and lifecycle details", "تفاصيل الجهاز ومراحل التشغيل")}</summary>
            <dl className="detail-list" dir="ltr">{technicalFields.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
          </details>
        </div>
      ) : null}
  </>;
  if (presentation === "inspector") return <aside className="diagnostic-inspector" aria-labelledby={headingId} aria-busy={details.loading}>
    <header className="diagnostic-inspector__header">
      <Button size="sm" variant="ghost" onClick={onClose}>{copy(locale, "Back to reports", "الرجوع للتقارير")}</Button>
      <h2 id={headingId} ref={heading} tabIndex={-1}>{title}</h2>
      <div className="cluster">{actions}</div>
    </header>
    <div className="diagnostic-inspector__body">{content}</div>
  </aside>;
  return <Modal open onClose={onClose} title={title} closeLabel={copy(locale, "Close", "إغلاق")} footer={actions}>
    {content}
  </Modal>;
}

function CrashGroupStateDialog({
  group,
  asOf,
  onClose,
  onChanged,
}: {
  group: AdminCrashGroup | null;
  asOf?: string;
  onClose: () => void;
  onChanged: (updated: { label: string; status: AdminCrashGroup["status"] }) => void;
}) {
  const { locale } = useExperience();
  const { admin } = useAdapters();
  const [status, setStatus] =
    useState<NonNullable<AdminCrashGroup["status"]>>(() => group?.status || "open");
  const [assignee, setAssignee] = useState(() => group?.assignee || "");
  const [note, setNote] = useState(() => group?.note || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const fieldId = useId();
  const dirty = Boolean(group && (status !== (group.status || "open") || assignee.trim() !== (group.assignee || "").trim() || note.trim() !== (group.note || "").trim()));
  const retainGroup = useCallback((route: AppRoute) => {
    const params = new URLSearchParams(route.state);
    return params.get("tab") === "groups" && (params.get("as_of") || undefined) === asOf;
  }, [asOf]);
  const confirmClose = useAdminNavigationProtection("diagnostics", group ? busy ? "saving" : dirty ? "draft" : null : null, retainGroup);
  const save = async () => {
    if (!group || !dirty || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const updated = await admin.updateCrashGroupState(group.fingerprint, {
        status,
        assignee: assignee.trim() || undefined,
        note: note.trim() || undefined,
      });
      onChanged({ label: group.message || group.error_type || group.fingerprint, status: updated.status });
    } catch (reason) {
      setError(adminMutationError(locale, reason));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      open={Boolean(group)}
      onClose={() => confirmClose(onClose)}
      closeDisabled={busy}
      title={copy(locale, "Update crash group", "تحديث مجموعة الأعطال")}
      closeLabel={copy(locale, "Close", "إغلاق")}
      footer={
        <Button variant="primary" loading={busy} disabled={!dirty} onClick={save}>
          {copy(locale, "Save", "حفظ")}
        </Button>
      }
    >
      <div className="stack">
        {group ? <p className="secondary"><bdi>{group.message || group.error_type || group.fingerprint}</bdi></p> : null}
        <FormField label={copy(locale, "Status", "الحالة")} htmlFor={fieldId + "-status"}>
          <Select
            id={fieldId + "-status"}
            disabled={busy}
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            {(["open", "investigating", "resolved", "ignored"] as const).map(
              (value) => (
                <option key={value} value={value}>
                  {statusLabel(value, locale)}
                </option>
              ),
            )}
          </Select>
        </FormField>
        <FormField label={copy(locale, "Assignee", "المسؤول")} htmlFor={fieldId + "-assignee"}>
          <Input
            id={fieldId + "-assignee"}
            disabled={busy}
            maxLength={160}
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
          />
        </FormField>
        <FormField label={copy(locale, "Note", "ملاحظة")} htmlFor={fieldId + "-note"}>
          <Textarea
            id={fieldId + "-note"}
            disabled={busy}
            maxLength={2000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </FormField>
        {error ? (
          <Alert
            title={copy(
              locale,
              "Could not save the change",
              "تعذر حفظ التغيير",
            )}
            tone="danger"
          >
            {error}
          </Alert>
        ) : null}
      </div>
    </Modal>
  );
}

function TamperResolveDialog({
  alert,
  userId,
  onClose,
  onChanged,
}: {
  alert: AdminTamperAlert | null;
  userId?: string;
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
  const retainTamperScope = useCallback((route: AppRoute) => {
    const params = new URLSearchParams(route.state);
    return userId ? params.get("user") === userId && params.get("user_tab") === "diagnostics" : params.get("tab") === "tamper";
  }, [userId]);
  const confirmClose = useAdminNavigationProtection(userId ? "users" : "diagnostics",
    alert ? busy ? "saving" : reason.trim() ? "draft" : null : null,
    retainTamperScope,
  );
  const resolve = async () => {
    if (!alert || reason.trim().length < 3 || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await admin.resolveTamperAlert(alert.id, reason.trim());
      onChanged();
    } catch (failure) {
      setError(adminMutationError(locale, failure));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      open={Boolean(alert)}
      onClose={() => confirmClose(onClose)}
      closeDisabled={busy}
      title={copy(locale, "Resolve tamper alert", "حل تنبيه العبث")}
      closeLabel={copy(locale, "Close", "إغلاق")}
      footer={
        <Button
          variant="primary"
          loading={busy}
          disabled={reason.trim().length < 3}
          onClick={resolve}
        >
          {copy(locale, "Resolve alert", "حل التنبيه")}
        </Button>
      }
    >
      <div className="stack">
        <FormField
          label={copy(locale, "Resolution note", "ملاحظة الحل")}
          htmlFor={fieldId + "-reason"}
          required
        >
          <Textarea
            id={fieldId + "-reason"}
            disabled={busy}
            maxLength={1000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </FormField>
        {error ? (
          <Alert
            title={copy(
              locale,
              "Could not resolve the alert",
              "تعذر حل التنبيه",
            )}
            tone="danger"
          >
            {error}
          </Alert>
        ) : null}
      </div>
    </Modal>
  );
}
