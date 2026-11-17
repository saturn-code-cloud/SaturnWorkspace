import { useState } from "react";
import { CircleAlert, TriangleAlert } from "lucide-react";
import type { AdminDiagnosticCoverage, AdminDiagnosticCoveragePeriod } from "../../../api/admin";
import { useAdapters } from "../../adapters/AdapterProvider";
import { useExperience } from "../../app/ExperienceProvider";
import type { Navigate } from "../../app/routes";
import { Button } from "../../components/ui/Button";
import { RouteLink } from "../../components/ui/RouteLink";
import { Card, PageHeader, Pagination, SectionHeader, StatCard, type Column } from "../../components/ui/DataDisplay";
import { AdminDataTable } from './AdminDataTable';
import { Alert } from "../../components/ui/Feedback";
import { DiagnosticDateRangePicker } from "./DiagnosticDateRangePicker";
import { diagnosticCoveragePeriod, diagnosticDateBounds, diagnosticRangeQuery, readDiagnosticDateRange, type DiagnosticDateRange } from "./diagnosticDateRange";
import { copy, date } from "./adminPageSupport";
import { useAsyncData } from "../../hooks/useAsyncData";
import { diagnosticsRoute } from "./adminRouteState";

export function AdminData({ routeState, navigate }: { routeState?: string; navigate: Navigate }) {
  const { locale } = useExperience();
  const { range, adjusted } = readDiagnosticDateRange(routeState);
  const period = diagnosticCoveragePeriod(range);
  const { earliest, today } = diagnosticDateBounds();
  const applyPeriod = (next: DiagnosticDateRange) => {
    navigate({ surface: "admin", page: "data", state: diagnosticRangeQuery(next) }, { preserveScroll: true });
  };
  return <div className="stack">
    <PageHeader title={copy(locale, "Data", "البيانات")}
      description={copy(locale, "Review the reports Saturn received and see which measurements are available.", "راجع التقارير التي وصلت إلى ساترن واعرف القياسات المتاحة.")}
      actions={<RouteLink className="ui-button ui-button--secondary ui-button--sm" navigate={navigate} route={diagnosticsRoute({ tab: "occurrences" })}>
        {copy(locale, "Open diagnostics", "فتح التشخيصات")}
      </RouteLink>} />
    <Card>
      <SectionHeader title={copy(locale, "Diagnostic reports by version", "تقارير التشخيص حسب الإصدار")}
        action={<DiagnosticDateRangePicker range={range} earliest={earliest} today={today} onApply={applyPeriod} />} />
      {adjusted ? <Alert tone="warning" title={copy(locale, "The saved dates are not fully available", "بعض التواريخ المحفوظة غير متاحة")}>
        {copy(locale, "The calendar shows the dates used for this report.", "زر التقويم يعرض الفترة المستخدمة في التقرير.")}
      </Alert> : null}
      <DiagnosticCoverageResults key={`${period.from}:${period.to}`} period={period} navigate={navigate} />
    </Card>
    <Card>
      <SectionHeader title={copy(locale, "Other measurements", "قياسات أخرى")} />
      <dl className="detail-list">
        <div><dt>{copy(locale, "Feature usage", "استخدام الميزات")}</dt><dd>
          {copy(locale, "Not measured here. Diagnostic reports do not show how often a feature is used.", "غير مقاس هنا. تقارير التشخيص لا توضح عدد مرات استخدام كل ميزة.")}
        </dd></div>
        <div><dt>{copy(locale, "App performance", "أداء الأداة")}</dt><dd>
          {copy(locale, "Not measured here. These reports do not cover all operation durations.", "غير مقاس هنا. التقارير لا تغطي مدة تنفيذ كل العمليات.")}
        </dd></div>
      </dl>
    </Card>
  </div>;
}

function DiagnosticCoverageResults({ period, navigate }: { period: AdminDiagnosticCoveragePeriod; navigate: Navigate }) {
  const { locale, formatNumber } = useExperience();
  const { admin } = useAdapters();
  const coverage = useAsyncData((signal) => admin.getDiagnosticCoverage(period, signal), [admin], `${period.from}:${period.to}`);
  const [page, setPage] = useState(1);
  const data = coverage.data;
  const busy = coverage.loading || coverage.refreshing;
  const pageSize = 12;
  const pages = Math.max(1, Math.ceil((data?.versions.length ?? 0) / pageSize));
  const currentPage = Math.min(page, pages);
  const columns: Column<AdminDiagnosticCoverage["versions"][number]>[] = [
    { key: "version", header: copy(locale, "Version", "الإصدار"), render: (row) => <bdi>{row.app_version || copy(locale, "Unknown", "غير معروف")}</bdi> },
    { key: "channel", header: copy(locale, "Channel", "القناة"), render: (row) => <bdi>{row.tool_channel || copy(locale, "Unknown", "غير معروفة")}</bdi> },
    { key: "errors", header: copy(locale, "Error reports", "تقارير الأخطاء"), render: (row) => formatNumber(row.errors) },
    { key: "warnings", header: copy(locale, "Warnings", "التحذيرات"), render: (row) => formatNumber(row.warnings) },
    { key: "latest", header: copy(locale, "Latest report", "أحدث تقرير"), render: (row) => <RouteLink
      aria-label={copy(locale, `Open latest report for ${row.app_version || "unknown version"} (${row.tool_channel || "unknown channel"})`, `فتح أحدث تقرير لإصدار ${row.app_version || "غير معروف"} (${row.tool_channel || "قناة غير معروفة"})`)}
      navigate={navigate} route={diagnosticsRoute({ tab: "occurrences", reportId: row.latest_report_id })}>
      <bdi>{date(row.latest_report_at, locale)}</bdi>
    </RouteLink> },
  ];
  return <div className="stack" aria-busy={busy}>
    <div className="split">
      <span className="secondary" role="status">{busy ? copy(locale, "Loading diagnostic data…", "جارٍ تحميل بيانات التشخيص…")
        : data ? copy(locale, `Records checked: ${formatNumber(data.window.scanned_reports)}`, `السجلات التي تمت مراجعتها: ${formatNumber(data.window.scanned_reports)}`) : null}</span>
      <Button size="sm" variant="secondary" disabled={busy} onClick={coverage.reload}>
        {coverage.error ? copy(locale, "Retry", "إعادة المحاولة") : copy(locale, "Refresh data", "تحديث البيانات")}
      </Button>
    </div>
    {coverage.error ? <Alert tone={data ? "warning" : "danger"} title={data
      ? copy(locale, "Refresh failed. Showing the previous results for this period.", "تعذّر التحديث. تُعرض آخر نتائج لهذه الفترة.")
      : copy(locale, "Could not load diagnostic data", "تعذر تحميل بيانات التشخيص")} /> : null}
    {data ? <>
      <p className="secondary">{copy(locale,
        "Dates use your device’s time zone. Each error or warning report counts once.",
        "الفترة حسب توقيت جهازك. يُحسب كل تقرير خطأ أو تحذير مرة واحدة.")}</p>
      {data.window.retention_limited ? <p className="secondary">{copy(locale,
        `Available records start at ${date(data.window.from, locale)}.`,
        `تبدأ السجلات المتاحة من ${date(data.window.from, locale)}.`)}</p> : null}
      {data.window.limited && data.window.oldest_scanned_at ? <Alert tone="warning" title={copy(locale, "Sample of recent records", "عيّنة من السجلات الحديثة")}>
        {copy(locale,
          `Showing the most recent ${formatNumber(data.window.scanned_reports)} of ${formatNumber(data.window.total_records)} records in this period. Oldest record checked: ${date(data.window.oldest_scanned_at, locale)}.`,
          `تمت مراجعة أحدث ${formatNumber(data.window.scanned_reports)} سجلًا من أصل ${formatNumber(data.window.total_records)} في هذه الفترة. أقدم سجل تمت مراجعته بتاريخ ${date(data.window.oldest_scanned_at, locale)}.`)}
      </Alert> : null}
      <div className="admin-coverage-counts">
        <StatCard label={data.window.limited ? copy(locale, "Error reports in sample", "تقارير الأخطاء في العيّنة") : copy(locale, "Error reports", "تقارير الأخطاء")}
          value={formatNumber(data.totals.errors)} icon={<CircleAlert size={16} aria-hidden="true" />} />
        <StatCard label={data.window.limited ? copy(locale, "Warnings in sample", "التحذيرات في العيّنة") : copy(locale, "Warnings", "التحذيرات")}
          value={formatNumber(data.totals.warnings)} icon={<TriangleAlert size={16} aria-hidden="true" />} />
      </div>
    </> : null}
    {data || !coverage.error ? <AdminDataTable comparison columns={columns} rows={(data?.versions ?? []).slice((currentPage - 1) * pageSize, currentPage * pageSize)}
      rowKey={(row) => row.latest_report_id} loading={coverage.loading}
      emptyTitle={copy(locale, "No error or warning reports found", "لا توجد تقارير أخطاء أو تحذيرات")}
      emptyBody={data?.window.limited
        ? copy(locale, "The sample contained no error or warning reports. Open diagnostics to check older reports.", "لا توجد تقارير أخطاء أو تحذيرات في العيّنة. افتح التشخيصات لمراجعة التقارير الأقدم.")
        : copy(locale, "Try a longer period, or open diagnostics to review individual reports.", "جرّب فترة أطول، أو افتح التشخيصات لمراجعة التقارير.")} /> : null}
    {pages > 1 ? <Pagination page={currentPage} pages={pages} disabled={busy} label={copy(locale, "Versions page", "صفحة الإصدارات")}
      previousLabel={copy(locale, "Previous", "السابق")} nextLabel={copy(locale, "Next", "التالي")} onChange={setPage} /> : null}
  </div>;
}
