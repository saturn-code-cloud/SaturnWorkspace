import { useCallback, useEffect, useState, type DependencyList } from "react";
import type { AdminDeviceChangeFilter, AdminDeviceChangeRequest } from "../../../api/admin";
import { parseServiceTimestamp } from "../../../lib/serviceTimestamp";

type Resource<T> = {
  data: T | null;
  loading: boolean;
  error: string;
  reload: () => void;
};

export function useResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  dependencies: DependencyList,
  refreshMs = 0,
  enabled = true,
): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setLoading(true);
      setError("");
      loader(controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setData(result);
        })
        .catch((reason) => {
          if (!controller.signal.aborted)
            setError(reason instanceof Error ? reason.message : "request_failed");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    });
    return () => {
      controller.abort();
    };
    // The caller controls refresh dependencies explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, version, enabled]);
  useEffect(() => {
    if (!enabled || !refreshMs) return undefined;
    const timer = window.setInterval(() => setVersion((value) => value + 1), refreshMs);
    return () => window.clearInterval(timer);
  }, [refreshMs, enabled]);
  return { data, loading, error, reload };
}

export function copy(locale: "ar" | "en", en: string, ar: string) {
  return locale === "ar" ? ar : en;
}

export function adminMutationError(locale: "ar" | "en", value: unknown) {
  const code = value instanceof Error ? value.message : String(value || "");
  const messages: Record<string, [string, string]> = {
    admin_operation_unconfirmed: [
      "Could not verify the result. Check the current record before trying again.",
      "تعذّر تأكيد النتيجة. راجع حالة السجل قبل إعادة المحاولة.",
    ],
    pending_grant_already_exists: [
      "A pending grant already exists for this email.",
      "يوجد بالفعل منح معلّق لهذا البريد.",
    ],
    pending_grant_not_found: [
      "The pending grant was not found.",
      "لم يتم العثور على المنح المعلّق.",
    ],
    pending_grant_not_pending: [
      "This grant is no longer pending.",
      "هذا المنح لم يعد معلّقًا.",
    ],
    pending_grant_create_failed: [
      "The pending grant could not be created. Try again.",
      "تعذر إنشاء المنح المعلّق. حاول مرة أخرى.",
    ],
    pending_grant_cancel_failed: [
      "The pending grant could not be cancelled. Try again.",
      "تعذر إلغاء المنح المعلّق. حاول مرة أخرى.",
    ],
    preview_changed: [
      "The record changed. Review the change again.",
      "تغيّر السجل. راجع التغيير مرة أخرى.",
    ],
    manual_grant_target_changed: [
      "The account details changed. Search for the user again.",
      "تغيّرت بيانات الحساب. ابحث عن المستخدم مرة أخرى.",
    ],
    admin_users_unavailable: [
      "Could not verify the account. Try again.",
      "تعذّر التحقق من الحساب. أعد المحاولة.",
    ],
    manual_grant_subscription_history_unavailable: [
      "Could not verify the subscription history. Try again before making any change.",
      "تعذّر التحقق من سجل الاشتراك. أعد المحاولة قبل إجراء أي تعديل.",
    ],
    device_reset_unavailable: [
      "Device details could not be loaded. Try again.",
      "تعذر تحميل بيانات الجهاز. حاول مرة أخرى.",
    ],
    historical_subscription_cannot_be_reactivated: [
      "This is a historical subscription. Open the current record or create a new grant.",
      "هذا اشتراك سابق. افتح السجل الحالي أو أنشئ منحًا جديدًا.",
    ],
    subscription_integrity_conflict: [
      "The subscription records conflict. Review the current record before continuing.",
      "توجد مشكلة في سجلات الاشتراك. راجع السجل الحالي قبل المتابعة.",
    ],
  };
  const message = messages[code] || [
    "The request could not be completed. Try again.",
    "تعذر إكمال الطلب. حاول مرة أخرى.",
  ];
  return copy(locale, message[0], message[1]);
}

export function date(value: unknown, locale: "ar" | "en") {
  const parsed = parseServiceTimestamp(value);
  return parsed
    ? new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(parsed)
    : "—";
}

export function statusLabel(value: unknown, locale: "ar" | "en") {
  const key = String(value || "").toLowerCase();
  const labels: Record<string, [string, string]> = {
    active: ["Active", "نشط"],
    suspended: ["Suspended", "معلّق"],
    pending_deletion: ["Pending deletion", "بانتظار الحذف"],
    deleted: ["Deleted", "محذوف"],
    none: ["No subscription", "لا يوجد اشتراك"],
    history_only: ["History only", "سجل سابق فقط"],
    integrity_conflict: ["Needs review", "يحتاج مراجعة"],
    entitled: ["Allowed", "مسموح"],
    not_entitled: ["Not allowed", "غير مسموح"],
    no_subscription: ["No subscription", "لا يوجد اشتراك"],
    grace_period: ["Grace period", "مهلة السداد"],
    payment_required: ["Payment required", "يتطلب الدفع"],
    policy_blocked: ["Blocked by policy", "محظور بالسياسة"],
    ok: ["No conflict", "سليم"],
    conflict: ["Needs review", "يحتاج مراجعة"],
    trialing: ["Trial", "فترة تجريبية"],
    scheduled: ["Scheduled", "لم يبدأ بعد"],
    expired: ["Expired", "منتهي"],
    cancel_at_period_end: ["Ends at period close", "ينتهي بنهاية الفترة"],
    cancelled: ["Cancelled", "ملغي"],
    canceled: ["Cancelled", "ملغي"],
    pending: ["Pending", "قيد الانتظار"],
    approved: ["Approved", "تمت الموافقة"],
    authorized: ["Authorized", "مصرّح به"],
    consumed: ["Used", "مستخدم"],
    rejected: ["Rejected", "مرفوض"],
    revoked: ["Revoked", "ملغى"],
    past_due: ["Payment overdue", "دفعة متأخرة"],
    open: ["Open", "مفتوح"],
    investigating: ["Investigating", "قيد الفحص"],
    resolved: ["Resolved", "تم الحل"],
    ignored: ["Ignored", "متجاهل"],
    suspend: ["Suspend", "تعليق"],
    reactivate: ["Reactivate", "إعادة تفعيل"],
    mark_pending_deletion: ["Mark for deletion", "وضع علامة للحذف"],
    resume: ["Resume", "استئناف"],
    cancel_now: ["Cancel now", "إلغاء الآن"],
    end_trial: ["End trial", "إنهاء الفترة التجريبية"],
    correct_expiry: ["Correct expiry", "تصحيح الانتهاء"],
    revoke_entitlement: ["Revoke entitlement", "إلغاء الاستحقاق"],
    revoke_session: ["Revoke session", "إلغاء الجلسة"],
    revoke_device: ["Revoke device", "إلغاء الجهاز"],
    revoke_all: ["Revoke all access", "إلغاء كل الوصول"],
    admin_action: ["Administrative action", "إجراء إداري"],
    customer_request: ["Customer request", "طلب العميل"],
    security_review: ["Security review", "مراجعة أمنية"],
    technical_support: ["Technical support", "دعم فني"],
    billing_correction: ["Billing correction", "تصحيح اشتراك"],
    subscription_recovery: ["Subscription recovery", "استعادة اشتراك"],
    policy_enforcement: ["Policy enforcement", "تطبيق سياسة"],
    other: ["Other", "سبب آخر"],
    super_admin: ["Super admin", "مدير عام"],
    support: ["Support", "دعم"],
    billing: ["Billing", "اشتراكات"],
    release_manager: ["Release manager", "إدارة الإصدارات"],
    security_auditor: ["Security auditor", "مدقق أمان"],
    read_only: ["Read only", "قراءة فقط"],
    completed: ["Completed", "تم"],
    ready: ["Ready", "جاهز"],
    configured: ["Configured", "مجهز"],
    disabled: ["Disabled", "معطل"],
    missing: ["Missing", "غير متوفر"],
    migration_pending: ["Migration pending", "بانتظار الترحيل"],
    waiting_external_integration: ["Waiting for provider", "بانتظار المزود"],
    default_super_admin_compatibility: ["Compatibility mode", "وضع التوافق"],
    not_configured: ["Not configured", "غير مجهز"],
    pending_registration: ["Waiting for registration", "بانتظار التسجيل"],
    weekly: ["Weekly", "أسبوعي"],
    monthly: ["Monthly", "شهري"],
    annual: ["Annual", "سنوي"],
    yearly: ["Annual", "سنوي"],
    lifetime: ["Lifetime", "مدى الحياة"],
    hours: ["hours", "ساعات"],
    days: ["days", "أيام"],
    weeks: ["weeks", "أسابيع"],
    months: ["months", "أشهر"],
    low: ["Low", "منخفض"],
    medium: ["Medium", "متوسط"],
    high: ["High", "مرتفع"],
    critical: ["Critical", "حرج"],
    mandatory: ["Mandatory", "إجباري"],
    optional: ["Optional", "اختياري"],
  };
  return labels[key]
    ? copy(locale, labels[key][0], labels[key][1])
    : String(value || "—").replaceAll("_", " ");
}

export function auditActionLabel(value: unknown, locale: "ar" | "en") {
  const key = String(value || "");
  const actions: Record<string, [string, string]> = {
    account_device_change_approved: ["Device change approved", "تمت الموافقة على تغيير الجهاز"],
    account_device_change_rejected: ["Device change declined", "تم رفض تغيير الجهاز"],
    account_device_binding_reset: ["Device unlinked", "تم فك ربط الجهاز"],
    "account.suspend": ["Account suspended", "تم تعليق الحساب"],
    "account.reactivate": ["Account reactivated", "تمت إعادة تفعيل الحساب"],
    "account.mark_pending_deletion": ["Account marked for deletion", "تم وضع الحساب في انتظار الحذف"],
    "subscription.suspend": ["Subscription suspended", "تم تعليق الاشتراك"],
    "subscription.resume": ["Subscription resumed", "تم استئناف الاشتراك"],
    "subscription.cancel_now": ["Subscription cancelled", "تم إلغاء الاشتراك"],
    "subscription.cancel_at_period_end": ["Subscription set to end at period close", "تم تحديد انتهاء الاشتراك بنهاية الفترة"],
    "subscription.correct_expiry": ["Subscription expiry changed", "تم تغيير انتهاء الاشتراك"],
    "subscription.end_trial": ["Trial ended", "تم إنهاء الفترة التجريبية"],
    "subscription.revoke_entitlement": ["Subscription access revoked", "تم إلغاء الوصول بالاشتراك"],
    subscription_manual_grant: ["Subscription granted", "تم منح اشتراك"],
    pending_subscription_grant_created: ["Grant queued for registration", "تم حفظ منح بانتظار التسجيل"],
    pending_subscription_grant_cancelled: ["Pending grant cancelled", "تم إلغاء المنح المعلّق"],
    subscription_recovery_evidence_created: ["Subscription recovery reference saved", "تم حفظ مرجع لاستعادة الاشتراك"],
    crash_group_state_update: ["Diagnostic group updated", "تم تحديث مجموعة التشخيص"],
    tamper_alert_resolved: ["Tamper alert resolved", "تم إغلاق تنبيه العبث"],
    publish: ["Release published", "تم نشر إصدار"],
    publish_targeted: ["Targeted release published", "تم نشر إصدار موجّه"],
    release_disable: ["Release disabled", "تم تعطيل إصدار"],
    policy_release_catalog_update: ["Release catalog updated", "تم تحديث قائمة الإصدارات"],
  };
  return actions[key] ? copy(locale, actions[key][0], actions[key][1]) : statusLabel(value, locale);
}

export function tone(value: unknown) {
  const key = String(value || "").toLowerCase();
  if (
    [
      "active",
      "entitled",
      "resolved",
      "completed",
      "ready",
      "configured",
    ].includes(key)
  )
    return "success" as const;
  if (
    [
      "suspended",
      "expired",
      "cancelled",
      "critical",
      "integrity_conflict",
      "degraded",
      "missing",
    ].includes(key)
  )
    return "danger" as const;
  if (
    [
      "pending_deletion",
      "past_due",
      "investigating",
      "migration_pending",
      "waiting_external_integration",
    ].includes(key)
  )
    return "warning" as const;
  return "neutral" as const;
}

export function deviceRequestStatusLabel(status: AdminDeviceChangeFilter, locale: "ar" | "en") {
  const labels: Record<AdminDeviceChangeFilter, [string, string]> = {
    pending: ["Pending", "قيد المراجعة"],
    approved: ["Approved", "تمت الموافقة"],
    rejected: ["Rejected", "مرفوض"],
    cancelled: ["Cancelled", "ملغى"],
    all: ["All requests", "كل الطلبات"],
  };
  return copy(locale, ...labels[status]);
}

export function deviceRequestTone(status: AdminDeviceChangeRequest["status"]) {
  return status === "approved" ? "success" : status === "rejected" ? "danger" : status === "pending" ? "warning" : "neutral";
}
