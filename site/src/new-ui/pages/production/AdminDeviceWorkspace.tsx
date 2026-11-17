import { useCallback, useRef, useState } from "react";
import { Monitor, RefreshCcw } from "lucide-react";
import type { AdminDeviceChangeFilter, AdminDeviceChangePreview, AdminDeviceChangeRequest } from "../../../api/admin";
import { useAdapters } from "../../adapters/AdapterProvider";
import { useExperience } from "../../app/ExperienceProvider";
import { useAdminNavigationProtection } from "../../app/adminNavigationProtection";
import type { AppRoute, Navigate } from "../../app/routes";
import { Button } from "../../components/ui/Button";
import { RouteLink } from "../../components/ui/RouteLink";
import { PageHeader, Pagination, SectionHeader, type Column } from "../../components/ui/DataDisplay";
import { AdminDataTable } from './AdminDataTable';
import { Alert, Badge, EmptyState, SkeletonStack } from "../../components/ui/Feedback";
import { FormField, Select, Textarea } from "../../components/ui/FormControls";
import { Modal } from "../../components/ui/Overlays";
import { adminMutationError, copy, date, deviceRequestStatusLabel, deviceRequestTone } from "./adminPageSupport";
import { deviceRequestsRoute } from "./adminRouteState";
import { AdminRecordPage } from "./AdminRecordPage";
import { useAsyncData } from "../../hooks/useAsyncData";
import { useRecordReturnFocus } from "./useRecordReturnFocus";

const DEVICE_REQUEST_STATUSES = ["pending", "approved", "rejected", "cancelled", "all"] as const;
const requestChanged = (code: string) =>
  ["device_change_request_not_pending", "device_change_request_changed", "preview_changed", "device_change_request_not_found"].includes(code);

function sameDeviceRequest(a: AdminDeviceChangeRequest, b: AdminDeviceChangeRequest) {
  return a.id === b.id && a.firebase_uid === b.firebase_uid && a.status === b.status &&
    a.updated_at === b.updated_at && a.current_binding_id === b.current_binding_id && a.requested_device_key === b.requested_device_key;
}

function deviceRequestError(value: unknown, locale: "ar" | "en") {
  const code = value instanceof Error ? value.message : String(value);
  if (code === "device_change_request_not_found") return copy(locale, "This request no longer exists or the link is invalid.", "الطلب مش موجود أو الرابط غير صالح.");
  if (code === "admin_permission_denied") return copy(locale, "You do not have permission for this action.", "ليس لديك صلاحية لتنفيذ هذا الإجراء.");
  if (["device_change_request_not_pending", "device_change_request_changed", "preview_changed"].includes(code)) {
    return copy(locale, "The request changed. Check its current state before making a decision.", "الطلب اتغيّر. راجع حالته الحالية قبل اتخاذ قرار.");
  }
  if (code === "device_change_requests_unavailable") return copy(locale, "Device requests are temporarily unavailable.", "طلبات تغيير الجهاز غير متاحة مؤقتًا.");
  if (code === "admin_operation_unconfirmed") return adminMutationError(locale, value);
  return copy(locale, "Could not complete the request. Try again.", "تعذر إكمال الطلب. أعد المحاولة.");
}

export function AdminDeviceRequests({ routeState, navigate, canDecide }: { routeState?: string; navigate: Navigate; canDecide: boolean }) {
  const { locale } = useExperience();
  const { admin } = useAdapters();
  const listRoot = useRef<HTMLDivElement>(null);
  const params = new URLSearchParams(routeState);
  const rawStatus = params.get("status");
  const status = DEVICE_REQUEST_STATUSES.find((value) => value === rawStatus) || "pending";
  const rawPage = Number(params.get("page") || 1);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 5000 ? rawPage : 1;
  const requestId = params.get("request") || "";
  const requests = useAsyncData((signal) => requestId ? Promise.resolve(null)
    : admin.listDeviceChangeRequests({ status, page }, signal), [admin], JSON.stringify([status, page, requestId]));
  useRecordReturnFocus(requestId, !requests.loading, listRoot);
  if (requestId) return <DeviceRequestRecord key={requestId} requestId={requestId} canDecide={canDecide}
    parentRoute={deviceRequestsRoute(status, page)} navigate={navigate} />;
  const busy = requests.loading || requests.refreshing;
  const columns: Column<AdminDeviceChangeRequest>[] = [
    { key: "account", header: copy(locale, "Account", "الحساب"), render: (row) => (
      <RouteLink className="admin-overview__record" route={deviceRequestsRoute(status, page, row.id)} navigate={navigate}>
        <strong><bdi>{row.account?.display_name || row.account?.normalized_email || row.firebase_uid}</bdi></strong>
        {row.account?.display_name && row.account.normalized_email ? <small><bdi>{row.account.normalized_email}</bdi></small> : null}
      </RouteLink>
    ) },
    { key: "device", header: copy(locale, "Requested device", "الجهاز المطلوب"), render: (row) => <bdi>{row.device_name || copy(locale, "Desktop device", "جهاز سطح مكتب")}</bdi> },
    { key: "status", header: copy(locale, "Status", "الحالة"), render: (row) => <Badge tone={deviceRequestTone(row.status)}>{deviceRequestStatusLabel(row.status, locale)}</Badge> },
    { key: "date", header: copy(locale, "Requested", "تاريخ الطلب"), render: (row) => date(row.requested_at, locale) },
  ];
  return <div className="stack" ref={listRoot}>
    <PageHeader title={copy(locale, "Device change requests", "طلبات تغيير الجهاز")}
      actions={<Button size="sm" loading={busy} leadingIcon={<RefreshCcw size={15} aria-hidden="true" />}
        onClick={requests.reload}>{copy(locale, "Refresh", "تحديث")}</Button>} />
    <div className="cluster">
      <FormField label={copy(locale, "Status", "الحالة")} htmlFor="device-request-list-status">
        <Select id="device-request-list-status" value={status} onChange={(event) => navigate(deviceRequestsRoute(event.target.value as AdminDeviceChangeFilter), { preserveScroll: true })}>
          {DEVICE_REQUEST_STATUSES.map((value) => <option key={value} value={value}>{deviceRequestStatusLabel(value, locale)}</option>)}
        </Select>
      </FormField>
    </div>
    {requests.error ? <Alert title={deviceRequestError(requests.error, locale)} tone="warning">
      <Button size="sm" onClick={requests.reload}>{copy(locale, "Retry", "إعادة المحاولة")}</Button>
    </Alert> : <AdminDataTable columns={columns} rows={requests.data?.items || []} rowKey={(row) => row.id} loading={requests.loading}
      emptyTitle={status === "pending" ? copy(locale, "No pending requests", "لا توجد طلبات معلّقة") : copy(locale, "No requests match this status", "لا توجد طلبات بهذه الحالة")}
      emptyBody=""
    />}
    {page > 1 || requests.data?.has_more ? <Pagination page={page} hasNext={!requests.error && Boolean(requests.data?.has_more)} disabled={busy}
      label={copy(locale, "Page", "الصفحة")} previousLabel={copy(locale, "Previous", "السابق")} nextLabel={copy(locale, "Next", "التالي")}
      onChange={(next) => navigate(deviceRequestsRoute(status, next), { preserveScroll: true })}
    /> : null}
  </div>;
}

function DeviceRequestRecord({ requestId, canDecide, parentRoute, navigate }: {
  requestId: string; canDecide: boolean; parentRoute: AppRoute; navigate: Navigate;
}) {
  const { locale } = useExperience();
  const { admin } = useAdapters();
  const details = useAsyncData((signal) => admin.getDeviceChangeRequest(requestId, signal), [admin, requestId]);
  const [resolved, setResolved] = useState<AdminDeviceChangeRequest | null>(null);
  const absent = details.error === "device_change_request_not_found";
  const request = absent ? null : details.data && details.data.status !== "pending" ? details.data : resolved || details.data;
  const [action, setAction] = useState<"" | "approve" | "reject">("");
  const [reason, setReason] = useState("");
  const [reviewed, setReviewed] = useState<{ preview: AdminDeviceChangePreview; operationId: string } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [phase, setPhase] = useState<"review" | "execute" | null>(null);
  const busy = Boolean(phase);
  const [error, setError] = useState("");
  const [unconfirmed, setUnconfirmed] = useState(false);
  const inFlight = useRef(false);
  const decision = useRef<HTMLSelectElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const retainRequest = useCallback((route: AppRoute) => new URLSearchParams(route.state).get("request") === requestId, [requestId]);
  const loading = details.loading || details.refreshing;
  const canEdit = canDecide && request?.status === "pending";
  useAdminNavigationProtection("device-requests", phase === "execute" ? "saving" : canEdit && reason.trim() ? "draft" : null, retainRequest);
  const canReview = canEdit && !loading && !details.error;
  const currentReview = request && reviewed && sameDeviceRequest(request, reviewed.preview.request) ? reviewed : null;
  const requestKey = request?.id;
  const decisionText = (value: "approve" | "reject") => value === "approve"
    ? copy(locale, "Approve request", "الموافقة على الطلب")
    : copy(locale, "Reject request", "رفض الطلب");
  const refresh = () => {
    if (!unconfirmed) setError("");
    details.reload();
  };
  const handleFailure = (failure: unknown) => {
    setError(deviceRequestError(failure, locale));
    const code = failure instanceof Error ? failure.message : "";
    if (requestChanged(code) || code === "admin_permission_denied") {
      setReviewed(null);
      setReviewOpen(false);
      setUnconfirmed(false);
      details.reload();
    }
  };
  const review = async () => {
    if (inFlight.current || !canReview || !requestKey || !action || reason.trim().length < 3) return;
    inFlight.current = true;
    setPhase("review");
    setReviewed(null);
    setError("");
    try {
      const preview = await admin.previewDeviceChange(requestKey, { action, reason: reason.trim() });
      if (!request || !preview?.request || !sameDeviceRequest(preview.request, request) ||
          preview.action !== action || preview.reason !== reason.trim() || !/^[a-f0-9]{64}$/i.test(preview.preview_hash)) {
        throw new Error("preview_changed");
      }
      setReviewed({ preview, operationId: crypto.randomUUID() });
      setReviewOpen(true);
    } catch (failure) {
      handleFailure(failure);
    } finally {
      inFlight.current = false;
      setPhase(null);
    }
  };
  const execute = async () => {
    if (inFlight.current || !canReview || !requestKey || !currentReview) return;
    inFlight.current = true;
    setPhase("execute");
    setError("");
    try {
      const result = await admin.executeDeviceChange(requestKey, {
        action: currentReview.preview.action,
        reason: currentReview.preview.reason,
        preview_hash: currentReview.preview.preview_hash,
        request_id: currentReview.operationId,
      });
      setResolved({ ...result.item, account: request?.account });
      setReviewed(null);
      setReviewOpen(false);
      setUnconfirmed(false);
      requestAnimationFrame(() => resultHeading.current?.focus());
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : "";
      if (requestChanged(code) || code === "admin_permission_denied") handleFailure(failure);
      else {
        setUnconfirmed(true);
        setError(adminMutationError(locale, "admin_operation_unconfirmed"));
      }
    } finally {
      inFlight.current = false;
      setPhase(null);
    }
  };
  const closeReview = () => {
    if (busy) return;
    if (!unconfirmed) setReviewed(null);
    setReviewOpen(false);
    requestAnimationFrame(() => decision.current?.focus());
  };
  const canRetrySame = Boolean(currentReview && unconfirmed);
  const confirmationOpen = Boolean(reviewOpen && currentReview && canEdit && (canReview || busy || unconfirmed));
  return <AdminRecordPage
    title={copy(locale, "Device change request", "طلب تغيير الجهاز")}
    description={request?.account?.display_name || request?.account?.normalized_email}
    parentLabel={copy(locale, "Device change requests", "طلبات تغيير الجهاز")}
    parentRoute={parentRoute} navigate={navigate}
    actions={!absent ? <Button size="sm" loading={loading} disabled={busy}
      leadingIcon={<RefreshCcw size={15} aria-hidden="true" />} onClick={refresh}>{copy(locale, "Refresh", "تحديث")}</Button> : null}>
    <div className="stack admin-device-record">
      {absent ? <EmptyState variant="section" title={copy(locale, "Request not found", "الطلب غير موجود")}
        body={deviceRequestError(details.error, locale)} /> : null}
      {details.error && !absent ? <Alert title={request
        ? copy(locale, "Could not refresh the request. Decisions are disabled until it loads.", "تعذّر تحديث الطلب. القرار غير متاح لحد ما تتحمّل حالته الحالية.")
        : deviceRequestError(details.error, locale)} tone="warning"
        action={<Button size="sm" onClick={refresh}>{copy(locale, "Retry", "إعادة المحاولة")}</Button>} /> : null}
      {details.loading && !request ? <div aria-busy="true"><SkeletonStack rows={4} /></div> : null}
      {request ? <>
        <section className="admin-record-overview" aria-label={copy(locale, "Request summary", "ملخص الطلب")}>
          <div className="admin-record-overview__identity">
            <span className="admin-record-overview__icon"><Monitor size={18} aria-hidden="true" /></span>
            <div><strong><bdi>{request.device_name || copy(locale, "Desktop device", "جهاز سطح مكتب")}</bdi></strong>
              <span className="secondary"><bdi>{request.account?.normalized_email || request.firebase_uid}</bdi></span></div>
            <Badge tone={deviceRequestTone(request.status)}>{deviceRequestStatusLabel(request.status, locale)}</Badge>
          </div>
          <div className="admin-record-overview__date"><div><span className="secondary">{copy(locale, "Requested", "تاريخ الطلب")}</span>
            <strong>{date(request.requested_at, locale)}</strong></div></div>
        </section>
        <section className="admin-inline-section">
          <SectionHeader title={copy(locale, "Request details", "تفاصيل الطلب")} />
          <dl className="detail-list">
            <div><dt>{copy(locale, "User reason", "سبب المستخدم")}</dt><dd><bdi>{request.user_reason || "—"}</bdi></dd></div>
            {request.platform || request.os_version ? <div><dt>{copy(locale, "Operating system", "نظام التشغيل")}</dt>
              <dd><bdi>{[request.platform, request.os_version].filter(Boolean).join(" · ")}</bdi></dd></div> : null}
            {request.app_version ? <div><dt>{copy(locale, "App version", "إصدار الأداة")}</dt><dd><bdi>{request.app_version}</bdi></dd></div> : null}
            {!request.device_name ? <div><dt>{copy(locale, "Device reference", "مرجع الجهاز")}</dt><dd><bdi>{request.requested_device_key || "—"}</bdi></dd></div> : null}
          </dl>
        </section>
        {request.status !== "pending" ? <section className="stack stack--compact admin-inline-section">
          <h2 className="admin-device-record__heading" tabIndex={-1} ref={resultHeading}>{copy(locale, "Request outcome", "نتيجة الطلب")}</h2>
          {resolved ? <Alert tone="success" title={resolved.status === "approved"
            ? copy(locale, "Request approved", "تمت الموافقة على الطلب")
            : copy(locale, "Request rejected", "تم رفض الطلب")} /> : null}
          {unconfirmed ? <Alert tone="info" title={copy(locale, "The request is no longer pending. Check the recorded outcome below.", "الطلب لم يعد معلّقًا. راجع النتيجة المسجّلة بالأسفل.")} /> : null}
          {(request.resolved_at || request.resolved_by || request.resolution_note) ? (
        <dl className="detail-list">
          {request.resolved_at ? <div><dt>{copy(locale, "Decided", "تاريخ القرار")}</dt><dd>{date(request.resolved_at, locale)}</dd></div> : null}
          {request.resolved_by ? <div><dt>{copy(locale, "Decided by", "صاحب القرار")}</dt><dd><bdi>{request.resolved_by}</bdi></dd></div> : null}
          {request.resolution_note ? <div><dt>{copy(locale, "Decision reason", "سبب القرار")}</dt><dd><bdi>{request.resolution_note}</bdi></dd></div> : null}
        </dl>
          ) : null}
        </section> : null}
        {request.status === "pending" && !canDecide ? <Alert title={copy(locale, "Read only", "عرض فقط")} tone="info">
          {copy(locale, "You can view this request. Approval and rejection require permission.", "تقدر تشوف الطلب. الموافقة والرفض يحتاجوا صلاحية.")}
        </Alert> : null}
      </> : null}
      {canEdit ? <section className="stack stack--compact admin-inline-section">
        <SectionHeader title={copy(locale, "Decision", "القرار")} />
        <FormField label={copy(locale, "Decision", "القرار")} htmlFor="device-request-decision">
          <Select ref={decision} id="device-request-decision" value={action} disabled={busy || !canReview || canRetrySame} onChange={(event) => {
            setAction(event.target.value as typeof action); setReviewed(null); setUnconfirmed(false); setError("");
          }}>
            <option value="" disabled>{copy(locale, "Choose a decision", "اختر قرارًا")}</option>
            <option value="approve">{copy(locale, "Approve", "موافقة")}</option>
            <option value="reject">{copy(locale, "Reject", "رفض")}</option>
          </Select>
        </FormField>
        <FormField label={copy(locale, "Decision reason", "سبب القرار")} htmlFor="device-request-decision-reason" required>
          <Textarea id="device-request-decision-reason" value={reason} disabled={busy || !canReview || canRetrySame} maxLength={1000} onChange={(event) => {
            setReason(event.target.value); setReviewed(null); setUnconfirmed(false); setError("");
          }} />
        </FormField>
        <div className="cluster">{canRetrySame ? <Button onClick={() => setReviewOpen(true)}>
          {copy(locale, "Review pending outcome", "راجع نتيجة القرار")}
        </Button> : <Button variant="primary" onClick={review} loading={phase === "review"}
          disabled={!canReview || busy || !action || reason.trim().length < 3}>{copy(locale, "Review decision", "مراجعة القرار")}</Button>}</div>
      </section> : null}
      {error && !confirmationOpen && !(unconfirmed && request && request.status !== "pending") ? <Alert title={error} tone="warning" /> : null}
    </div>
    <Modal open={confirmationOpen} onClose={closeReview} closeDisabled={busy}
      title={copy(locale, "Review device change decision", "مراجعة قرار تغيير الجهاز")}
      closeLabel={copy(locale, "Close", "إغلاق")}
      footer={currentReview ? <>
        {unconfirmed ? <Button onClick={refresh} loading={loading} disabled={busy}>{copy(locale, "Check request status", "تحقّق من حالة الطلب")}</Button>
          : <Button onClick={closeReview} disabled={busy}>{copy(locale, "Edit decision", "تعديل القرار")}</Button>}
        <Button variant={currentReview.preview.action === "reject" ? "danger" : "primary"} onClick={execute}
          loading={phase === "execute"} disabled={!canReview || busy}>
          {unconfirmed ? copy(locale, "Retry same decision", "إعادة إرسال نفس القرار") : decisionText(currentReview.preview.action)}
        </Button>
      </> : undefined}>
      {currentReview && request ? <div className="stack">
        <dl className="detail-list">
          <div><dt>{copy(locale, "Account", "الحساب")}</dt><dd><bdi>{request.account?.normalized_email || request.firebase_uid}</bdi></dd></div>
          <div><dt>{copy(locale, "Requested device", "الجهاز المطلوب")}</dt><dd><bdi>{request.device_name || request.requested_device_key}</bdi></dd></div>
          <div><dt>{copy(locale, "Decision", "القرار")}</dt><dd>{decisionText(currentReview.preview.action)}</dd></div>
          <div><dt>{copy(locale, "Decision reason", "سبب القرار")}</dt><dd><bdi>{currentReview.preview.reason}</bdi></dd></div>
        </dl>
        <Alert tone="warning" title={copy(locale, "Effect of this decision", "أثر القرار")}>
          {currentReview.preview.action === "approve"
            ? copy(locale, "Existing app sessions for this account will end. The new device will replace the current linked device.", "جلسات الأداة الحالية للحساب هتنتهي، والجهاز الجديد هيحل محل الجهاز المرتبط.")
            : copy(locale, "The request will be rejected. The current device link will not change.", "الطلب هيترفض، وربط الجهاز الحالي مش هيتغيّر.")}
        </Alert>
        {details.error ? <Alert title={deviceRequestError(details.error, locale)} tone="warning" /> : null}
        {error ? <Alert title={error} tone="warning" /> : null}
      </div> : null}
    </Modal>
  </AdminRecordPage>;
}
