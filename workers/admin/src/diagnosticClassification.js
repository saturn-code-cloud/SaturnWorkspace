const EXPECTED_MESSAGES = new Set([
  "account not found",
  "account_not_found",
  "cancelled",
  "email already exists",
  "invalid_email_requires_at",
  "profile does not exist",
  "profile_not_found",
  "session_ip_already_used",
]);

const WARNING_ERROR_TYPES = new Set([
  "googledriveautosyncfailed",
  "googledriveinitialsyncfailed",
  "updatemanifesterror",
  "updatemanifestfetcherror",
  "timeouterror",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isTraceSupplement(row, errorType) {
  if (errorType !== "diagnostictracefollowup") return false;
  const trace = row?.raw_payload?.trace;
  return trace?.format === "saturnws.technical-trace.v1"
    && UUID_RE.test(String(trace.run_id || ""))
    && UUID_RE.test(String(trace.parent_event_id || ""));
}

const NETWORK_WARNING_TOKENS = [
  "winerror 10051",
  "winerror 10054",
  "winerror 10060",
  "winerror 10065",
  "connection reset",
  "getaddrinfo",
  "network timeout",
  "network_timeout",
  "timed out",
  "unable to reach",
];

export function classifyDiagnostic(row) {
  const errorType = String(row?.error_type || "").trim().toLowerCase();
  const message = String(row?.message || "").trim().toLowerCase();
  const stack = String(row?.stack_trace || "").trim().toLowerCase();
  const combined = `${message} ${stack}`;

  if (EXPECTED_MESSAGES.has(message)) return "expected";
  if (isTraceSupplement(row, errorType)) return "supplement";
  const context = String(row?.raw_payload?.context || "").toLowerCase();
  if (context === "app.main" || context === "extension-agent.main" || errorType.startsWith("launcher_") || errorType === "frontendstartuptimeout" || message === "startup_preload_missing") return "error";
  if (String(row?.raw_payload?.severity || "").toLowerCase() === "warning" || errorType === "previousrununclosed") return "warning";
  if (WARNING_ERROR_TYPES.has(errorType)) return "warning";
  if (NETWORK_WARNING_TOKENS.some((token) => combined.includes(token))) return "warning";
  return "error";
}

export function isActionableCrash(row) {
  return classifyDiagnostic(row) === "error";
}
