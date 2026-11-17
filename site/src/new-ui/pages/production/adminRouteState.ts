import type { AdminDeviceChangeFilter } from "../../../api/admin";

const directoryQuery = (params: URLSearchParams, maxLength = 200) => (params.get("search") || "").replace(/\p{Cc}/gu, "").trim().slice(0, maxLength);
const directoryPage = (params: URLSearchParams, name = "page") => {
  const raw = params.get(name) || "1";
  const value = Number(raw);
  return /^\d+$/.test(raw) && Number.isSafeInteger(value) && value >= 1 && value <= 5000 ? value : 1;
};

export const USER_ACCOUNT_STATES = ["active", "suspended", "pending_deletion"] as const;
export const USER_SUBSCRIPTION_STATES = ["none", "active", "history_only", "integrity_conflict"] as const;
export type UserDirectoryState = {
  query: string; page: number;
  accountStatus: typeof USER_ACCOUNT_STATES[number] | "";
  subscription: typeof USER_SUBSCRIPTION_STATES[number] | "";
};

export function readUserDirectoryState(routeState?: string): UserDirectoryState {
  const params = new URLSearchParams(routeState);
  return { query: directoryQuery(params, 254), page: directoryPage(params),
    accountStatus: USER_ACCOUNT_STATES.find((value) => value === params.get("account_status")) || "",
    subscription: USER_SUBSCRIPTION_STATES.find((value) => value === params.get("subscription_status")) || "" };
}

export function userDirectoryRoute(directory: UserDirectoryState, userId?: string) {
  const params = new URLSearchParams();
  if (directory.query) params.set("search", directory.query);
  if (directory.page > 1) params.set("page", String(directory.page));
  if (directory.accountStatus) params.set("account_status", directory.accountStatus);
  if (directory.subscription) params.set("subscription_status", directory.subscription);
  if (userId) params.set("user", userId);
  return { surface: "admin" as const, page: "users", state: params.size ? "?" + params : undefined };
}

export const SUBSCRIPTION_LIFECYCLES = ["trialing", "active", "past_due", "cancel_at_period_end", "cancelled", "expired", "suspended"] as const;
export type SubscriptionDirectoryState = {
  query: string; page: number; pendingPage: number;
  current: "" | "current" | "history";
  lifecycle: typeof SUBSCRIPTION_LIFECYCLES[number] | "";
};

export function readSubscriptionDirectoryState(routeState?: string): SubscriptionDirectoryState {
  const params = new URLSearchParams(routeState);
  const current = params.get("current");
  return { query: directoryQuery(params), page: directoryPage(params), pendingPage: directoryPage(params, "pending_page"),
    current: current === "current" || current === "history" ? current : "",
    lifecycle: SUBSCRIPTION_LIFECYCLES.find((value) => value === params.get("lifecycle")) || "" };
}

export function subscriptionDirectoryRoute(directory: SubscriptionDirectoryState, subscriptionId?: string) {
  const params = new URLSearchParams();
  if (directory.query) params.set("search", directory.query);
  if (directory.page > 1) params.set("page", String(directory.page));
  if (directory.pendingPage > 1) params.set("pending_page", String(directory.pendingPage));
  if (directory.current) params.set("current", directory.current);
  if (directory.lifecycle) params.set("lifecycle", directory.lifecycle);
  if (subscriptionId) params.set("subscription", subscriptionId);
  return { surface: "admin" as const, page: "subscriptions", state: params.size ? "?" + params : undefined };
}

export function readReleaseChannel(routeState?: string): "stable" | "beta" {
  return new URLSearchParams(routeState).get("channel") === "stable" ? "stable" : "beta";
}

export function releaseChannelRoute(channel: "stable" | "beta") {
  return { surface: "admin" as const, page: "releases", state: channel === "stable" ? "?channel=stable" : undefined };
}

export const SUPPORT_QUEUE_STATUSES = ["open", "awaiting_support", "awaiting_customer", "reopened", "closed", "blocked"] as const;
export const SUPPORT_QUEUE_PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type SupportQueueState = {
  scope: "all" | "waiting";
  query: string;
  status: typeof SUPPORT_QUEUE_STATUSES[number] | "";
  priority: typeof SUPPORT_QUEUE_PRIORITIES[number] | "";
  page: number;
};

export function readSupportQueueState(routeState?: string): SupportQueueState {
  const params = new URLSearchParams(routeState);
  const scope = params.get("scope") === "waiting" ? "waiting" : "all";
  const page = Number(params.get("page") || 1);
  return {
    scope,
    query: (params.get("query") || "").replace(/\p{Cc}/gu, "").trim().slice(0, 200),
    status: scope === "all" ? SUPPORT_QUEUE_STATUSES.find((value) => value === params.get("status")) || "" : "",
    priority: SUPPORT_QUEUE_PRIORITIES.find((value) => value === params.get("priority")) || "",
    page: Number.isSafeInteger(page) && page >= 1 && page <= 5000 ? page : 1,
  };
}

export function supportQueueRoute(queue: SupportQueueState, threadId?: string) {
  const params = new URLSearchParams();
  if (queue.scope === "waiting") params.set("scope", queue.scope);
  if (queue.query) params.set("query", queue.query);
  if (queue.scope === "all" && queue.status) params.set("status", queue.status);
  if (queue.priority) params.set("priority", queue.priority);
  if (queue.page > 1) params.set("page", String(queue.page));
  if (threadId) params.set("thread", threadId);
  return { surface: "admin" as const, page: "support", state: params.size ? "?" + params : undefined };
}

export function deviceRequestsRoute(status: AdminDeviceChangeFilter = "pending", page = 1, requestId?: string) {
  const params = new URLSearchParams();
  if (status !== "pending") params.set("status", status);
  if (page > 1) params.set("page", String(page));
  if (requestId) params.set("request", requestId);
  return { surface: "admin" as const, page: "device-requests", state: params.size ? "?" + params : undefined };
}

export type DiagnosticTab = "groups" | "occurrences" | "warnings" | "tamper";

export type DiagnosticGroupStatus = "all" | "attention" | "resolved" | "ignored";

export type DiagnosticLocation = { tab: DiagnosticTab; status?: DiagnosticGroupStatus; asOf?: string; reportId?: string };

export function diagnosticsRoute({ tab, status, asOf, reportId }: DiagnosticLocation) {
  const params = new URLSearchParams();
  if (tab !== "occurrences") params.set("tab", tab);
  if (tab === "groups" && status && status !== "all") params.set("status", status);
  if (tab === "groups" && asOf) params.set("as_of", asOf);
  if (reportId) params.set("report", reportId);
  return { surface: "admin" as const, page: "diagnostics", state: params.size ? "?" + params : undefined };
}
