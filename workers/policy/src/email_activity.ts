import { EMAIL_CATALOG, resolveEmailEventType } from "./email_catalog"

export type EmailActivityView = "outbound" | "inbound" | "scheduled" | "events" | "flags"

export const EMAIL_PAYLOAD_STATE_SQL = "CASE WHEN sensitive_payload_expires_at IS NULL THEN 'none' WHEN julianday(sensitive_payload_expires_at) IS NULL OR julianday(sensitive_payload_expires_at) <= julianday('now') THEN 'expired' WHEN sensitive_payload_ciphertext IS NULL THEN 'purged' ELSE 'available' END"
const JOB_FIELDS = "id, email_type, catalog_event_type, template_key, template_version, email_category, recipient, sender, subject, linked_user_id, linked_ticket_id, status, attempt_count, max_attempts, provider_message_id, last_error, last_attempt_at, next_attempt_at, sent_at, delivered_at, created_at, updated_at, " + EMAIL_PAYLOAD_STATE_SQL + " AS sensitive_payload_state"
const EVENT_FIELDS = "id, event_type, provider_message_id, email_job_id, processed_at, created_at"
const SOURCES = {
  outbound: { table: "email_jobs", fields: JOB_FIELDS, search: ["recipient", "subject", "id", "email_type", "provider_message_id"], time: "created_at", key: "id", status: "status" },
  inbound: { table: "inbound_email_messages", fields: "id, provider_email_id, thread_id, sender_email, recipient_email, subject, status, rejection_reason, received_at, processed_at, created_at", search: ["sender_email", "recipient_email", "subject", "id", "thread_id"], time: "created_at", key: "id", status: "status" },
  scheduled: { table: "notification_schedule", fields: "id, event_type, recipient, status, scheduled_for, attempts, last_error, linked_user_id, linked_ticket_id, created_at, updated_at", search: ["recipient", "event_type", "id"], time: "scheduled_for", key: "id", status: "status" },
  events: { table: "email_events", fields: EVENT_FIELDS, search: ["event_type", "provider_message_id", "email_job_id", "id"], time: "created_at", key: "id", status: "event_type" },
  flags: { table: "email_recipient_flags", fields: "email, status, reason, provider_message_id, created_at, updated_at", search: ["email", "reason", "provider_message_id"], time: "updated_at", key: "email", status: "status" },
} as const

export class EmailActivityQueryError extends Error {}

async function readRows(statement: D1PreparedStatement): Promise<Record<string, unknown>[]> {
  const result = await statement.all<Record<string, unknown>>()
  if (result.success !== true || !Array.isArray(result.results)) throw new Error("email_activity_unavailable")
  return result.results
}

function integerParameter(url: URL, key: string, fallback: number, maximum: number): number {
  const raw = url.searchParams.get(key)
  if (raw === null) return fallback
  if (!/^[1-9][0-9]*$/.test(raw)) throw new EmailActivityQueryError("email_activity_query_invalid")
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value > maximum) throw new EmailActivityQueryError("email_activity_query_invalid")
  return value
}

export async function readEmailActivity(url: URL, db: D1Database) {
  const rawView = url.searchParams.get("view") || "outbound"
  if (!Object.hasOwn(SOURCES, rawView)) throw new EmailActivityQueryError("email_activity_query_invalid")
  const view = rawView as EmailActivityView
  const source = SOURCES[view]
  const limit = integerParameter(url, "limit", 25, 100)
  const page = integerParameter(url, "page", 1, 10000)
  const query = (url.searchParams.get("query") || "").trim()
  const status = (url.searchParams.get("status") || "").trim()
  const jobId = (url.searchParams.get("job_id") || "").trim()
  if (query.length > 200 || status.length > 80 || jobId.length > 160 || (jobId && view !== "events")) {
    throw new EmailActivityQueryError("email_activity_query_invalid")
  }
  const clauses: string[] = []
  const values: (string | number)[] = []
  if (query) {
    clauses.push("(" + source.search.map((field) => `instr(lower(coalesce(${field}, '')), lower(?)) > 0`).join(" OR ") + ")")
    values.push(...source.search.map(() => query))
  }
  if (status) { clauses.push(`${source.status} = ?`); values.push(status) }
  if (jobId) { clauses.push("email_job_id = ?"); values.push(jobId) }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
  const rows = await readRows(db.prepare(
    `SELECT ${source.fields} FROM ${source.table} ${where} ORDER BY datetime(${source.time}) DESC, ${source.key} DESC LIMIT ? OFFSET ?`,
  ).bind(...values, limit + 1, (page - 1) * limit))
  return { success: true, view, query, status, job_id: jobId || null, page, limit,
    has_more: rows.length > limit, items: rows.slice(0, limit), generated_at: new Date().toISOString() }
}

export function emailJobRetryReason(job: Record<string, unknown>, recipientStatus?: unknown): string | null {
  if (!["failed", "bounced", "complained"].includes(String(job.status || ""))) return "email_job_not_retryable"
  const eventType = resolveEmailEventType(job.catalog_event_type || job.email_type)
  if (!eventType || !EMAIL_CATALOG[eventType].retry_allowed) return "email_job_retry_not_allowed"
  if (["bounced", "complained", "suppressed"].includes(String(recipientStatus || ""))) return "recipient_suppressed"
  if (["expired", "purged"].includes(String(job.sensitive_payload_state || ""))) return "sensitive_payload_unavailable"
  if (job.last_error === "sensitive_payload_expired") return "sensitive_payload_expired"
  if (job.last_error === "sensitive_payload_unavailable") return "sensitive_payload_unavailable"
  return null
}

export async function readEmailJob(db: D1Database, jobId: string) {
  if (!jobId || jobId.length > 160) throw new EmailActivityQueryError("email_activity_query_invalid")
  const rows = await readRows(db.prepare(`SELECT ${JOB_FIELDS},
    (SELECT status FROM email_recipient_flags WHERE email = lower(email_jobs.recipient)) AS recipient_status
    FROM email_jobs WHERE id = ? LIMIT 1`).bind(jobId))
  const job = rows[0]
  if (!job) return null
  const retryReason = emailJobRetryReason(job, job.recipient_status)
  let events: Record<string, unknown>[] = []
  let eventsUnavailable = false
  try {
    events = await readRows(db.prepare(`SELECT ${EVENT_FIELDS} FROM email_events WHERE email_job_id = ? ORDER BY datetime(created_at) ASC, id ASC LIMIT 101`).bind(jobId))
  } catch { eventsUnavailable = true }
  return { success: true, job: { ...job, retry_allowed: retryReason === null, retry_blocked_reason: retryReason },
    events: events.slice(0, 100), events_has_more: events.length > 100, events_unavailable: eventsUnavailable,
    generated_at: new Date().toISOString() }
}
