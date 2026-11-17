import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build, transform } from 'esbuild'
import { Miniflare } from 'miniflare'
import { cloudflareWorkersTestShim } from './esbuild-cloudflare-test-shim.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temp = await mkdtemp(path.join(root, 'node_modules', '.saturnws-support-notifications-'))
const bundle = path.join(temp, 'worker.mjs')
const adminToken = 'fixture-local-admin-token'
const authEmailToken = 'fixture-local-auth-email-token'
const webhookKey = Buffer.alloc(32, 7)
const webhookSecret = `whsec_${webhookKey.toString('base64')}`
const userByToken = new Map([
  ['token-a', { id: 'firebase-user-a', email: 'user-a@example.test' }],
  ['token-b', { id: 'firebase-user-b', email: 'user-b@example.test' }],
  ['token-c', { id: 'firebase-user-c', email: 'user-c@example.test' }],
])
const receivedMessages = new Map()
let failReceiveOnce = true
let failSend = false
let authUnavailable = false
let authThrows = false
const sendRequests = []

await build({
  entryPoints: [path.join(root, 'src', 'index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: bundle,
  logLevel: 'silent',
  plugins: [cloudflareWorkersTestShim],
})

const mf = new Miniflare({
  rootPath: temp,
  modules: true,
  modulesRoot: temp,
  scriptPath: path.basename(bundle),
  compatibilityDate: '2026-05-28',
  d1Databases: ['DB'],
  r2Buckets: ['SUPPORT_ATTACHMENTS'],
  bindings: {
    POLICY_SIGNING_SEED_B64: Buffer.alloc(32, 3).toString('base64'),
    ADMIN_TOKEN_SHA256: createHash('sha256').update(adminToken).digest('hex'),
    EMAIL_OUTBOUND_ENABLED: 'true',
    EMAIL_INBOUND_ENABLED: 'true',
    EMAIL_SUPPORT_ENABLED: 'true',
    EMAIL_AUTH_ENABLED: 'true',
    EMAIL_BILLING_ENABLED: 'false',
    EMAIL_RELEASE_ENABLED: 'false',
    EMAIL_SECURITY_ENABLED: 'false',
    EMAIL_SCHEDULER_ENABLED: 'true',
    EMAIL_FROM_SUPPORT: 'SaturnWS Support <support@mail.saturnws.com>',
    EMAIL_REPLY_DOMAIN: 'mail.saturnws.com',
    APP_PUBLIC_URL: 'https://saturnws.com',
    RESEND_SEND_API_KEY: 'local-send-key',
    RESEND_RECEIVE_API_KEY: 'local-receive-key',
    RESEND_WEBHOOK_SECRET: webhookSecret,
    AUTH_EMAIL_ENQUEUE_TOKEN: authEmailToken,
    EMAIL_SENSITIVE_PAYLOAD_KEY_B64: Buffer.alloc(32, 11).toString('base64'),
    RESEND_API_BASE: 'https://resend.local',
  },
  serviceBindings: {
    AUTH_SERVICE: async (request) => {
      if (authThrows) throw new Error('private_provider_failure_detail')
      if (authUnavailable) return Response.json({ success: false, error: 'provider_detail_must_not_leak' }, { status: 503 })
      const input = await request.json().catch(() => ({}))
      const user = userByToken.get(String(input.id_token || ''))
      return Response.json(user ? { success: true, user } : { success: false, error: 'unauthorized' }, { status: user ? 200 : 401 })
    },
    RESEND_SERVICE: async (request) => {
      const url = new URL(request.url)
      if (request.method === 'POST' && url.pathname === '/emails') {
        const input = await request.json().catch(() => ({}))
        sendRequests.push(input)
        if (failSend || String(input.to || '').includes('send-fail')) return Response.json({ message: 'provider unavailable' }, { status: 503 })
        return Response.json({ id: `provider-${createHash('sha1').update(String(input.subject || Date.now())).digest('hex').slice(0, 12)}` })
      }
      const emailId = decodeURIComponent(url.pathname.split('/').pop() || '')
      if (emailId === 'provider-fail' && failReceiveOnce) {
        failReceiveOnce = false
        return Response.json({ message: 'temporary failure' }, { status: 503 })
      }
      const message = receivedMessages.get(emailId)
      return message ? Response.json(message) : Response.json({ message: 'not found' }, { status: 404 })
    },
  },
})

try {
  const activityBundle = path.join(temp, 'email-activity.mjs')
  await build({ entryPoints: [path.join(root, 'src/email_activity.ts')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: activityBundle, logLevel: 'silent' })
  const { EMAIL_PAYLOAD_STATE_SQL, readEmailActivity, readEmailJob, emailJobRetryReason } = await import(pathToFileURL(activityBundle).href)
  for (const result of [{ success: false, results: [] }, { success: true, results: null }, { success: true }]) {
    const brokenDb = { prepare() { return { bind() { return this }, async all() { return result } } } }
    await assert.rejects(readEmailActivity(new URL('https://fixture.invalid/?view=outbound'), brokenDb), /email_activity_unavailable/)
    await assert.rejects(readEmailJob(brokenDb, 'fixture-id'), /email_activity_unavailable/)
  }
  const partialDb = { prepare(sql) { return { bind() { return this }, async all() {
    if (sql.includes('FROM email_events')) throw new Error('fixture-private-events-failure')
    return { success: true, results: [{ id: 'fixture-id', status: 'failed', email_type: 'admin.email_test' }] }
  } } } }
  const partialJob = await readEmailJob(partialDb, 'fixture-id')
  assert.equal(partialJob.job.id, 'fixture-id')
  assert.equal(partialJob.events_unavailable, true)
  assert.equal(partialJob.events_has_more, false)
  assert.doesNotMatch(JSON.stringify(partialJob), /fixture-private/)
  assert.equal(emailJobRetryReason({ status: 'failed', email_type: 'support.inbound_received' }), 'email_job_retry_not_allowed')
  assert.equal(emailJobRetryReason({ status: 'failed', email_type: 'admin.email_test', sensitive_payload_state: 'purged' }), 'sensitive_payload_unavailable')
  assert.equal(emailJobRetryReason({ status: 'failed', email_type: 'admin.email_test' }, 'suppressed'), 'recipient_suppressed')
  console.log('PASS Email activity rejects failed and malformed reads; auxiliary event failure preserves the selected job')
  const policySource = await readFile(path.join(root, 'src/index.ts'), 'utf8')
  const supportHandler = policySource.slice(policySource.indexOf('async function handleAdminSupportMessages('), policySource.indexOf('async function handleAdminSupportAttachment('))
  const compiledSupportHandler = await transform(supportHandler, { loader: 'ts', target: 'es2022' })
  const readConversation = new Function('normalizeText', 'supportBlockMatchSql', 'loadMessageAttachments', 'normalizeSupportThread', 'normalizeSupportMessage', 'json', 'console', compiledSupportHandler.code + '\nreturn handleAdminSupportMessages;')(
    (value) => String(value || '').trim(), () => '1 = 1', async () => new Map(), (value) => value, (value) => value,
    (value) => Response.json(value), { warn() {} },
  )
  let readMode = 'ok'
  let readMarkers = 0
  const failureEnv = { DB: { prepare(sql) { return { bind() { return this },
    async first() { return { id: 'fixture-thread', subject: 'Fixture' } },
    async all() {
      if (sql.includes('support_messages')) {
        if (readMode === 'messages-failed') return { success: false }
        if (readMode === 'messages-malformed') return { success: true, results: null }
        return { success: true, results: [{ id: 'fixture-message', thread_id: 'fixture-thread', sender: 'user', body: 'Fixture message', admin_unread: 1 }] }
      }
      if (readMode === 'audit-threw') throw new Error('private_fixture_database_failure')
      return readMode === 'audit-failed' ? { success: false } : { success: true, results: [] }
    },
    async run() { readMarkers++; if (readMode === 'marker-threw') throw new Error('private_fixture_marker_failure'); return { success: true } },
  } } } }
  const conversationRequest = new Request('https://fixture.invalid/v1/admin/support/messages?thread_id=fixture-thread')
  for (const mode of ['ok', 'audit-failed', 'audit-threw', 'marker-threw']) {
    readMode = mode
    const result = await (await readConversation(conversationRequest, failureEnv)).json()
    assert.equal(result.messages[0].body, 'Fixture message')
    assert.equal(result.audit_unavailable, mode.startsWith('audit-'))
    assert.ok(!JSON.stringify(result).includes('private_fixture'))
  }
  for (const mode of ['messages-failed', 'messages-malformed']) {
    readMode = mode
    const before = readMarkers
    await assert.rejects(readConversation(conversationRequest, failureEnv), /support_inbox_unavailable/)
    assert.equal(readMarkers, before, 'Failed conversation reads must not mark the ticket read')
  }
  console.log('PASS Support conversation reads preserve messages when auxiliary history or read markers fail; malformed messages fail explicitly')
  const db = await mf.getD1Database('DB')
  const migrationDir = path.join(root, 'migrations')
  for (const name of (await readdir(migrationDir)).filter((name) => name.endsWith('.sql')).sort()) {
    const supportReceiptsMigration = name === '0019_support_admin_history_and_reads.sql'
    if (supportReceiptsMigration) {
      await db.exec("INSERT INTO support_threads (id, subject, status, admin_last_read_at) VALUES ('fixture-receipt-migration', 'Receipt migration fixture', 'closed', '2026-11-01 12:00:00');")
      await db.exec(`INSERT INTO support_messages (id, thread_id, sender, sender_role, body, created_at) VALUES
        ('fixture-before-marker', 'fixture-receipt-migration', 'user', 'customer', 'fixture', '2026-11-01 11:59:59'),
        ('fixture-at-marker', 'fixture-receipt-migration', 'user', 'email_inbound', 'fixture', '2026-11-01 12:00:00'),
        ('fixture-after-marker', 'fixture-receipt-migration', 'user', 'customer', 'fixture', '2026-11-01 12:00:01'),
        ('fixture-note-before-marker', 'fixture-receipt-migration', 'admin', 'internal_note', 'fixture', '2026-11-01 11:59:59');`.replace(/\r?\n/g, ' '))
    }
    const sql = (await readFile(path.join(migrationDir, name), 'utf8'))
      .replace(/^\s*--.*$/gm, '')
      .replace(/\r?\n/g, ' ')
    await db.exec(sql)
    if (supportReceiptsMigration) {
      const { results } = await db.prepare("SELECT id, admin_read_at FROM support_messages WHERE thread_id = 'fixture-receipt-migration' ORDER BY id").all()
      assert.deepEqual(results.map(({ id, admin_read_at: read }) => [id, read]), [
        ['fixture-after-marker', null],
        ['fixture-at-marker', '2026-11-01 12:00:00'],
        ['fixture-before-marker', '2026-11-01 12:00:00'],
        ['fixture-note-before-marker', null],
      ])
      await db.exec("DELETE FROM support_threads WHERE id = 'fixture-receipt-migration';")
    }
  }

  const post = async (pathname, body, token = 'token-a', headers = {}) => {
    const response = await mf.dispatchFetch(`https://api.saturnws.com${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers },
      body: JSON.stringify({ id_token: token, ...body }),
    })
    return { response, body: await response.json() }
  }
  const adminPost = async (pathname, body) => {
    const response = await mf.dispatchFetch(`https://api.saturnws.com${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(body),
    })
    return { response, body: await response.json() }
  }
  const adminGet = async (pathname) => {
    const response = await mf.dispatchFetch(`https://api.saturnws.com${pathname}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    return { response, body: await response.json() }
  }

  const verificationCode = '482731'
  const authEnqueueResponse = await mf.dispatchFetch('https://api.saturnws.com/v1/internal/email/auth/enqueue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authEmailToken}` },
    body: JSON.stringify({
      event_type: 'auth.email_verification',
      idempotency_key: 'auth-email-verification:fixture:1',
      verification_request_id: 'fixture-verification-1',
      user_id: 'firebase-user-a',
      purpose: 'email_verification',
      recipient: 'user-a@example.test',
      locale: 'en',
      payload: { code: verificationCode, expires_at: new Date(Date.now() + 600_000).toISOString() },
    }),
  })
  assert.equal(authEnqueueResponse.status, 200)
  const authEnqueueBody = await authEnqueueResponse.json()
  assert.equal(authEnqueueBody.status, 'sent')
  assert.equal(authEnqueueBody.delivery?.mode, 'immediate')
  assert.equal(authEnqueueBody.delivery?.sent, true)
  const sentAuthJob = await db.prepare('SELECT * FROM email_jobs WHERE id = ?1').bind(authEnqueueBody.job_id).first()
  assert.equal(sentAuthJob.status, 'sent')
  assert.equal(sentAuthJob.sensitive_payload_ciphertext, null)
  assert.ok(sentAuthJob.sensitive_payload_purged_at)
  assert.ok(!JSON.stringify(sentAuthJob).includes(verificationCode), 'OTP must not be exposed outside encrypted payload')

  const createKey = 'ticket:create:a'
  const attachmentForm = new FormData()
  attachmentForm.set('file', new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], 'evidence.png', { type: 'image/png' }))
  const encodedAttachment = new Request('https://local.test', { method: 'POST', body: attachmentForm })
  const attachmentResponse = await mf.dispatchFetch('https://api.saturnws.com/v1/web/support/attachments', { method: 'POST', headers: { Authorization: 'Bearer token-a', 'Content-Type': encodedAttachment.headers.get('Content-Type') }, body: await encodedAttachment.arrayBuffer() })
  const attachmentPayload = await attachmentResponse.json()
  assert.equal(attachmentResponse.status, 200, JSON.stringify(attachmentPayload))
  const created = await post('/v1/web/support/messages', { subject: 'Account help', body: 'Please review my account.', idempotency_key: createKey, attachment_ids: [attachmentPayload.attachment.id] }, 'token-a', { 'Idempotency-Key': createKey })
  assert.equal(created.response.status, 200)
  assert.ok(created.body.thread_id)
  const attachmentThread = await post('/v1/web/support/thread', { thread_id: created.body.thread_id }, 'token-a')
  assert.equal(attachmentThread.body.messages[0].attachments.length, 1)
  const attachmentDownload = await mf.dispatchFetch(`https://api.saturnws.com/v1/web/support/attachments/${attachmentPayload.attachment.id}`, { headers: { Authorization: 'Bearer token-a' } })
  assert.equal(attachmentDownload.status, 200)
  assert.match(attachmentDownload.headers.get('content-disposition') || '', /attachment;/)
  const foreignAttachmentDownload = await mf.dispatchFetch(`https://api.saturnws.com/v1/web/support/attachments/${attachmentPayload.attachment.id}`, { headers: { Authorization: 'Bearer token-b' } })
  assert.equal(foreignAttachmentDownload.status, 404)
  const orphanForm = new FormData()
  orphanForm.set('file', new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], 'orphan.png', { type: 'image/png' }))
  const encodedOrphan = new Request('https://local.test', { method: 'POST', body: orphanForm })
  const orphanResponse = await mf.dispatchFetch('https://api.saturnws.com/v1/web/support/attachments', { method: 'POST', headers: { Authorization: 'Bearer token-a', 'Content-Type': encodedOrphan.headers.get('Content-Type') }, body: await encodedOrphan.arrayBuffer() })
  assert.equal(orphanResponse.status, 200)
  const orphanPayload = await orphanResponse.json()
  await db.prepare("UPDATE support_attachments SET created_at = datetime('now', '-2 days') WHERE id = ?1").bind(orphanPayload.attachment.id).run()
  const cleanupRun = await adminPost('/v1/admin/email/process', {})
  assert.equal(cleanupRun.body.processed.cleanup.attachmentsDeleted, 1)
  const orphanRow = await db.prepare('SELECT status, deleted_at FROM support_attachments WHERE id = ?1').bind(orphanPayload.attachment.id).first()
  assert.equal(orphanRow.status, 'deleted')
  assert.ok(orphanRow.deleted_at)
  const duplicateCreate = await post('/v1/web/support/messages', { subject: 'Account help', body: 'Please review my account.', idempotency_key: createKey })
  assert.equal(duplicateCreate.body.thread_id, created.body.thread_id)
  assert.equal(duplicateCreate.body.duplicate, true)

  const owned = await post('/v1/web/support/thread', { thread_id: created.body.thread_id })
  assert.equal(owned.response.status, 200)
  assert.equal(owned.body.messages.length, 1)
  const forbidden = await post('/v1/web/support/thread', { thread_id: created.body.thread_id }, 'token-b')
  assert.equal(forbidden.response.status, 404)

  const replyKey = 'ticket:reply:a:1'
  await post('/v1/web/support/reply', { thread_id: created.body.thread_id, body: 'Additional detail.', idempotency_key: replyKey })
  const duplicateReply = await post('/v1/web/support/reply', { thread_id: created.body.thread_id, body: 'Additional detail.', idempotency_key: replyKey })
  assert.equal(duplicateReply.body.duplicate, true)

  const adminReplyKey = 'ticket:admin-reply:a:1'
  const adminReply = await adminPost('/v1/admin/support/reply', { thread_id: created.body.thread_id, body: 'We are reviewing this.', email_requested: true, idempotency_key: adminReplyKey })
  assert.equal(adminReply.response.status, 200)
  assert.equal(adminReply.body.delivery_mode, 'portal_and_email')
  const duplicateAdminReply = await adminPost('/v1/admin/support/reply', { thread_id: created.body.thread_id, body: 'We are reviewing this.', email_requested: true, idempotency_key: adminReplyKey })
  assert.equal(duplicateAdminReply.body.duplicate, true)
  await adminPost('/v1/admin/support/reply', { thread_id: created.body.thread_id, body: 'Internal context.', internal_note: true, email_requested: true, idempotency_key: 'ticket:note:a:1' })
  const customerThread = await post('/v1/web/support/thread', { thread_id: created.body.thread_id })
  assert.equal(customerThread.body.messages.some((message) => message.sender_role === 'internal_note'), false)

  const notifications = await post('/v1/web/notifications/list', { limit: 20 })
  assert.equal(notifications.response.status, 200)
  assert.equal(notifications.body.unread_count, 1)
  assert.equal(notifications.body.items.filter((item) => item.type === 'support_reply').length, 1)
  const otherNotifications = await post('/v1/web/notifications/list', { limit: 20 }, 'token-b')
  assert.equal(otherNotifications.body.items.length, 0)
  authUnavailable = true
  const unavailableNotifications = await post('/v1/web/notifications/list', { limit: 20 })
  assert.equal(unavailableNotifications.response.status, 503)
  assert.equal(unavailableNotifications.body.error, 'identity_service_unavailable')
  authUnavailable = false
  authThrows = true
  const unreachableNotifications = await post('/v1/web/notifications/list', { limit: 20 })
  assert.equal(unreachableNotifications.response.status, 503)
  assert.equal(unreachableNotifications.body.error, 'identity_service_unavailable')
  assert.equal(JSON.stringify(unreachableNotifications.body).includes('private_provider_failure_detail'), false)
  authThrows = false
  await post('/v1/web/notifications/read', { notification_id: notifications.body.items[0].id })
  const readState = await post('/v1/web/notifications/list', { limit: 20 })
  assert.equal(readState.body.unread_count, 0)
  assert.equal(readState.body.items[0].read_at !== null, true)
  await post('/v1/web/notifications/read-all', {})

  await adminPost('/v1/admin/support/status', { thread_id: created.body.thread_id, status: 'closed', idempotency_key: 'ticket:status:a:closed' })
  const closedReply = await post('/v1/web/support/reply', { thread_id: created.body.thread_id, body: 'Should be blocked until reopen.', idempotency_key: 'ticket:reply:a:closed' })
  assert.equal(closedReply.response.status, 409)
  const reopened = await post('/v1/web/support/status', { thread_id: created.body.thread_id, status: 'open' })
  assert.equal(reopened.body.status, 'reopened')

  await adminPost('/v1/admin/support/block', { thread_id: created.body.thread_id, blocked: true, reason: 'test' })
  const blockedReply = await post('/v1/web/support/reply', { thread_id: created.body.thread_id, body: 'Blocked.', idempotency_key: 'ticket:reply:a:blocked' })
  assert.equal(blockedReply.response.status, 403)
  await adminPost('/v1/admin/support/block', { thread_id: created.body.thread_id, blocked: false })

  for (let index = 0; index < 5; index += 1) {
    const result = await post('/v1/web/support/messages', { subject: `Rate ${index}`, body: 'Rate test', idempotency_key: `rate:c:${index}` }, 'token-c')
    assert.equal(result.response.status, 200)
  }
  const limited = await post('/v1/web/support/messages', { subject: 'Rate exceeded', body: 'Rate test', idempotency_key: 'rate:c:6' }, 'token-c')
  assert.equal(limited.response.status, 429)

  const emailJob = await db.prepare("SELECT reply_to, provider_message_id FROM email_jobs WHERE linked_ticket_id = ?1 AND email_type = 'support.admin_replied' ORDER BY created_at DESC LIMIT 1").bind(created.body.thread_id).first()
  assert.ok(emailJob?.reply_to)
  const inboundAddress = String(emailJob.reply_to)
  receivedMessages.set('received-valid', { id: 'received-valid', from: 'user-a@example.test', to: [inboundAddress], subject: 'Re: Account help', text: 'Reply from email.\n\nOn an earlier date, support wrote:\nquoted text' })
  const webhook = async (eventId, emailId, extraData = {}) => {
    const payload = JSON.stringify({ type: 'email.received', data: { email_id: emailId, ...extraData } })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = createHmac('sha256', webhookKey).update(`${eventId}.${timestamp}.${payload}`).digest('base64')
    const response = await mf.dispatchFetch('https://api.saturnws.com/api/webhooks/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'svix-id': eventId, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` },
      body: payload,
    })
    return { response, body: await response.json() }
  }
  const invalidWebhook = await mf.dispatchFetch('https://api.saturnws.com/api/webhooks/resend', { method: 'POST', body: '{}' })
  assert.equal(invalidWebhook.status, 401)
  const inbound = await webhook('evt-inbound-valid', 'received-valid')
  assert.equal(inbound.response.status, 200)
  assert.equal(inbound.body.status, 'processed')
  const duplicateInbound = await webhook('evt-inbound-valid', 'received-valid')
  assert.equal(duplicateInbound.body.duplicate, true)
  const inboundMessageCount = await db.prepare("SELECT COUNT(*) AS count FROM support_messages WHERE idempotency_key = 'inbound:evt-inbound-valid'").first()
  assert.equal(Number(inboundMessageCount.count), 1)

  receivedMessages.set('received-unknown-token', { id: 'received-unknown-token', from: 'user-a@example.test', to: ['reply+aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@mail.saturnws.com'], subject: 'Unknown', text: 'Unknown token' })
  assert.equal((await webhook('evt-unknown-token', 'received-unknown-token')).body.reason, 'reply_token_not_found')

  const replyTokenValue = /reply\+([a-f0-9]+)@/i.exec(inboundAddress)?.[1]
  assert.ok(replyTokenValue)
  const replyTokenHash = createHash('sha256').update(replyTokenValue).digest('hex')
  await db.prepare("UPDATE support_reply_tokens SET expires_at = datetime('now', '-1 minute') WHERE token_hash = ?1").bind(replyTokenHash).run()
  receivedMessages.set('received-expired-token', { id: 'received-expired-token', from: 'user-a@example.test', to: [inboundAddress], subject: 'Expired', text: 'Expired token' })
  assert.equal((await webhook('evt-expired-token', 'received-expired-token')).body.reason, 'reply_token_expired')
  await db.prepare("UPDATE support_reply_tokens SET expires_at = datetime('now', '+1 day'), active = 0, revoked_at = datetime('now') WHERE token_hash = ?1").bind(replyTokenHash).run()
  receivedMessages.set('received-revoked-token', { id: 'received-revoked-token', from: 'user-a@example.test', to: [inboundAddress], subject: 'Revoked', text: 'Revoked token' })
  assert.equal((await webhook('evt-revoked-token', 'received-revoked-token')).body.reason, 'reply_token_revoked')
  await db.prepare("UPDATE support_reply_tokens SET active = 1, revoked_at = NULL WHERE token_hash = ?1").bind(replyTokenHash).run()

  receivedMessages.set('received-wrong-sender', { id: 'received-wrong-sender', from: 'attacker@example.test', to: [inboundAddress], subject: 'Re', text: 'Wrong sender' })
  assert.equal((await webhook('evt-wrong-sender', 'received-wrong-sender')).body.reason, 'sender_mismatch')
  receivedMessages.set('received-auto', { id: 'received-auto', from: 'user-a@example.test', to: [inboundAddress], subject: 'Auto reply', text: 'Automated', headers: { 'auto-submitted': 'auto-replied' } })
  assert.equal((await webhook('evt-auto-reply', 'received-auto')).body.reason, 'automated_reply_rejected')
  receivedMessages.set('provider-fail', { id: 'provider-fail', from: 'user-a@example.test', to: [inboundAddress], subject: 'Retry', text: 'Retry success' })
  const failedRetrieve = await webhook('evt-provider-retry', 'provider-fail')
  assert.equal(failedRetrieve.response.status, 503)
  const retriedRetrieve = await webhook('evt-provider-retry', 'provider-fail')
  assert.equal(retriedRetrieve.response.status, 200)
  assert.equal(retriedRetrieve.body.status, 'processed')

  await adminPost('/v1/admin/support/status', { thread_id: created.body.thread_id, status: 'closed', idempotency_key: 'ticket:status:a:closed-email' })
  receivedMessages.set('received-closed-ticket', { id: 'received-closed-ticket', from: 'user-a@example.test', to: [inboundAddress], subject: 'Reopen by email', text: 'Please reopen this ticket.' })
  const reopenedByEmail = await webhook('evt-closed-ticket', 'received-closed-ticket')
  assert.equal(reopenedByEmail.body.status, 'processed')
  assert.equal((await db.prepare('SELECT status FROM support_threads WHERE id = ?1').bind(created.body.thread_id).first()).status, 'reopened')

  await adminPost('/v1/admin/support/block', { thread_id: created.body.thread_id, blocked: true, reason: 'inbound-test' })
  receivedMessages.set('received-blocked', { id: 'received-blocked', from: 'user-a@example.test', to: [inboundAddress], subject: 'Blocked', text: 'Blocked inbound.' })
  assert.equal((await webhook('evt-blocked-inbound', 'received-blocked')).body.reason, 'support_blocked')
  await adminPost('/v1/admin/support/block', { thread_id: created.body.thread_id, blocked: false })

  const sentEventPayload = JSON.stringify({ type: 'email.delivered', data: { email_id: emailJob.provider_message_id, to: ['user-a@example.test'] } })
  const sentEventId = 'evt-delivered'
  const sentTimestamp = String(Math.floor(Date.now() / 1000))
  const sentSignature = createHmac('sha256', webhookKey).update(`${sentEventId}.${sentTimestamp}.${sentEventPayload}`).digest('base64')
  const deliveredResponse = await mf.dispatchFetch('https://api.saturnws.com/api/webhooks/resend', { method: 'POST', headers: { 'svix-id': sentEventId, 'svix-timestamp': sentTimestamp, 'svix-signature': `v1,${sentSignature}` }, body: sentEventPayload })
  assert.equal(deliveredResponse.status, 200)
  assert.equal((await db.prepare('SELECT status FROM email_jobs WHERE provider_message_id = ?1').bind(emailJob.provider_message_id).first()).status, 'delivered')

  await db.prepare("INSERT INTO email_cron_locks (name, owner, locked_until, created_at, updated_at) VALUES ('email-operations', 'other', datetime('now', '+5 minutes'), datetime('now'), datetime('now')) ON CONFLICT(name) DO UPDATE SET owner = 'other', locked_until = datetime('now', '+5 minutes'), updated_at = datetime('now')").run()
  const locked = await adminPost('/v1/admin/email/process', {})
  assert.equal(locked.body.processed.skipped, true)
  await db.prepare("UPDATE email_cron_locks SET owner = NULL, locked_until = datetime('now', '-1 second') WHERE name = 'email-operations'").run()

  const failedTest = await adminPost('/v1/admin/email/test', { recipient: 'send-fail@example.test', email_type: 'admin.email_test', message: 'Failure path' })
  assert.equal(failedTest.response.status, 200)
  const failedJobId = failedTest.body.job_id
  let failedJob = await db.prepare('SELECT status, attempt_count FROM email_jobs WHERE id = ?1').bind(failedJobId).first()
  assert.equal(failedJob.status, 'queued')
  assert.equal(Number(failedJob.attempt_count), 1)
  await db.prepare("UPDATE email_jobs SET attempt_count = max_attempts - 1, next_attempt_at = datetime('now') WHERE id = ?1").bind(failedJobId).run()
  await adminPost('/v1/admin/email/process', {})
  failedJob = await db.prepare('SELECT status FROM email_jobs WHERE id = ?1').bind(failedJobId).first()
  assert.equal(failedJob.status, 'failed')
  await db.prepare(`INSERT INTO email_jobs (id, idempotency_key, email_type, recipient, sender, subject, html_body, status, created_at)
    VALUES ('fixture-other-queued-job', 'fixture-other-queued-job', 'admin.email_test', 'other-queued@example.test', 'fixture@example.test', 'Other queued message', '<p>Fixture</p>', 'queued', '2026-01-01 00:00:00')`).run()
  const retriedJob = await adminPost('/v1/admin/email/retry', { job_id: failedJobId })
  assert.equal(retriedJob.response.status, 200)
  assert.equal(retriedJob.body.job_id, failedJobId)
  assert.equal(retriedJob.body.processed.processed, 1)
  assert.equal(retriedJob.body.processed.sent, 0)
  assert.equal((await db.prepare('SELECT status FROM email_jobs WHERE id = ?1').bind(failedJobId).first()).status, 'queued')
  assert.equal((await db.prepare("SELECT status FROM email_jobs WHERE id = 'fixture-other-queued-job'").first()).status, 'queued', 'A retry must not process an unrelated queued email')
  assert.equal((await adminPost('/v1/admin/email/retry', { job_id: failedJobId })).response.status, 409)
  const directedTest = await adminPost('/v1/admin/email/test', { recipient: 'directed-test@example.test', email_type: 'admin.email_test', message: 'Directed fixture' })
  assert.equal(directedTest.body.processed.sent, 1)
  assert.equal((await db.prepare('SELECT status FROM email_jobs WHERE id = ?1').bind(directedTest.body.job_id).first()).status, 'sent')
  assert.equal((await db.prepare("SELECT status FROM email_jobs WHERE id = 'fixture-other-queued-job'").first()).status, 'queued', 'Sending a test must not process an unrelated queued email')
  await db.prepare(`INSERT INTO email_jobs (id, idempotency_key, email_type, recipient, sender, subject, html_body, status)
    VALUES ('fixture-concurrent-retry', 'fixture-concurrent-retry', 'admin.email_test', 'concurrent-retry@example.test', 'fixture@example.test', 'Concurrent retry', '<p>Fixture</p>', 'failed')`).run()
  const beforeConcurrent = sendRequests.filter((input) => input.to?.includes('concurrent-retry@example.test')).length
  const concurrentRetries = await Promise.all([adminPost('/v1/admin/email/retry', { job_id: 'fixture-concurrent-retry' }), adminPost('/v1/admin/email/retry', { job_id: 'fixture-concurrent-retry' })])
  assert.deepEqual(concurrentRetries.map((result) => result.response.status).sort(), [200, 409])
  assert.equal(sendRequests.filter((input) => input.to?.includes('concurrent-retry@example.test')).length, beforeConcurrent + 1)
  assert.equal((await db.prepare("SELECT status FROM email_jobs WHERE id = 'fixture-other-queued-job'").first()).status, 'queued')
  await db.prepare(`INSERT INTO email_jobs (id, idempotency_key, email_type, recipient, sender, subject, status)
    VALUES ('fixture-racing-suppression', 'fixture-racing-suppression', 'admin.email_test', 'racing-suppression@example.test', 'fixture@example.test', 'Racing suppression', 'failed')`).run()
  const retryHandlerSource = policySource.slice(policySource.indexOf('async function handleAdminEmailRetry('), policySource.indexOf('async function handleAdminEmailTest('))
  const retryHandlerCode = (await transform(retryHandlerSource, { loader: 'ts', target: 'es2022' })).code
  const forbiddenRetrySideEffect = () => assert.fail('A job changed during review must not be sent or audited as retried')
  const retryHandler = new Function('normalizeText', 'normalizeEmailAddress', 'EMAIL_PAYLOAD_STATE_SQL', 'emailJobRetryReason', 'dbChanges', 'updatePortalNotificationEmailStatus', 'auditSupportEvent', 'processEmailJobImmediately', 'json', retryHandlerCode + '; return handleAdminEmailRetry;')(
    (value) => String(value || '').trim(), (value) => String(value || '').trim().toLowerCase(), EMAIL_PAYLOAD_STATE_SQL, emailJobRetryReason,
    (result) => result?.meta?.changes || 0, forbiddenRetrySideEffect, forbiddenRetrySideEffect, forbiddenRetrySideEffect,
    (body, status = 200) => Response.json(body, { status }),
  )
  const racingDb = { prepare(sql) { return { bind(...values) {
    const statement = db.prepare(sql).bind(...values)
    return { async first() {
      const result = await statement.first()
      if (sql.startsWith('SELECT status FROM email_recipient_flags')) {
        await db.prepare("INSERT INTO email_recipient_flags (email, status) VALUES ('racing-suppression@example.test', 'suppressed')").run()
      }
      return result
    }, run() { return statement.run() } }
  } } } }
  const suppressedDuringReview = await retryHandler(new Request('https://fixture.invalid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: 'fixture-racing-suppression' }) }), { DB: racingDb })
  assert.equal(suppressedDuringReview.status, 409)
  assert.equal((await suppressedDuringReview.json()).error, 'email_job_changed')
  assert.equal((await db.prepare("SELECT status FROM email_jobs WHERE id = 'fixture-racing-suppression'").first()).status, 'failed')
  await db.prepare("DELETE FROM email_jobs WHERE id = 'fixture-other-queued-job'").run()

  const bounceTest = await adminPost('/v1/admin/email/test', { recipient: 'bounce@example.test', email_type: 'admin.email_test', message: 'Bounce path' })
  const bounceJob = await db.prepare('SELECT provider_message_id FROM email_jobs WHERE id = ?1').bind(bounceTest.body.job_id).first()
  const bouncePayload = JSON.stringify({ type: 'email.bounced', data: { email_id: bounceJob.provider_message_id, to: ['bounce@example.test'], reason: 'mailbox rejected' } })
  const bounceEventId = 'evt-bounced'
  const bounceTimestamp = String(Math.floor(Date.now() / 1000))
  const bounceSignature = createHmac('sha256', webhookKey).update(`${bounceEventId}.${bounceTimestamp}.${bouncePayload}`).digest('base64')
  const bounceResponse = await mf.dispatchFetch('https://api.saturnws.com/api/webhooks/resend', { method: 'POST', headers: { 'svix-id': bounceEventId, 'svix-timestamp': bounceTimestamp, 'svix-signature': `v1,${bounceSignature}` }, body: bouncePayload })
  assert.equal(bounceResponse.status, 200)
  assert.equal((await db.prepare("SELECT status FROM email_recipient_flags WHERE email = 'bounce@example.test'").first()).status, 'bounced')
  const suppressedRetry = await adminPost('/v1/admin/email/retry', { job_id: bounceTest.body.job_id })
  assert.equal(suppressedRetry.response.status, 409)
  assert.equal(suppressedRetry.body.error, 'recipient_suppressed')
  await db.prepare("UPDATE email_jobs SET status = 'failed' WHERE id = ?1").bind(authEnqueueBody.job_id).run()
  const purgedRetry = await adminPost('/v1/admin/email/retry', { job_id: authEnqueueBody.job_id })
  assert.equal(purgedRetry.response.status, 409)
  assert.equal(purgedRetry.body.error, 'sensitive_payload_unavailable')
  const duplicateBounce = await mf.dispatchFetch('https://api.saturnws.com/api/webhooks/resend', { method: 'POST', headers: { 'svix-id': bounceEventId, 'svix-timestamp': bounceTimestamp, 'svix-signature': `v1,${bounceSignature}` }, body: bouncePayload })
  assert.equal((await duplicateBounce.json()).duplicate, true)
  await adminPost('/v1/admin/email/test', { recipient: 'bounce@example.test', email_type: 'admin.email_test', message: 'Suppressed path' })
  assert.equal((await db.prepare("SELECT status FROM email_jobs WHERE recipient = 'bounce@example.test' ORDER BY created_at DESC, rowid DESC LIMIT 1").first()).status, 'suppressed')

  const audit = await adminGet(`/v1/admin/support/messages?thread_id=${encodeURIComponent(created.body.thread_id)}`)
  assert.equal(audit.response.status, 200)
  assert.ok(audit.body.audit.some((event) => event.event_type === 'support_reply'))
  assert.ok(audit.body.audit.some((event) => event.event_type === 'inbound_email_processed'))

  const insertInboxThread = db.prepare(`INSERT INTO support_threads
    (id, email, subject, status, priority, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`)
  await db.batch(Array.from({ length: 101 }, (_, index) => insertInboxThread.bind(
    `fixture-closed-${index}`, 'archive@example.test', 'Archived', 'closed', 'urgent', '2026-11-01 12:00:00',
  )))
  await db.batch([
    insertInboxThread.bind('fixture-inbox-first', 'first@example.test', 'Inbox unique 100%_ old', 'waiting_for_support', 'urgent', '2026-10-01 12:00:00'),
    insertInboxThread.bind('fixture-inbox-second', 'second@example.test', 'Inbox unique next', 'reopened', 'urgent', '2026-10-02 12:00:00'),
    insertInboxThread.bind('fixture-inbox-third', 'third@example.test', 'Inbox unique newest', 'open', 'normal', '2026-10-03 12:00:00'),
    insertInboxThread.bind('fixture-inbox-blocked', 'inbox-blocked@example.test', 'Inbox unique blocked', 'awaiting_support', 'urgent', '2026-09-01 12:00:00'),
  ])
  await db.prepare("INSERT INTO support_message_blocks (id, email) VALUES ('fixture-inbox-block', 'inbox-blocked@example.test')").run()
  const inbox = '/v1/admin/support?view=inbox'
  const unauthenticatedInbox = await mf.dispatchFetch(`https://api.saturnws.com${inbox}`)
  assert.equal(unauthenticatedInbox.status, 401)
  const legacyInbox = await adminGet('/v1/admin/support')
  assert(!legacyInbox.body.threads.some((thread) => thread.id === 'fixture-inbox-first'))
  const firstInboxPage = await adminGet(`${inbox}&scope=waiting&priority=urgent&query=Inbox%20unique&limit=1`)
  assert.equal(firstInboxPage.response.status, 200)
  assert.equal(firstInboxPage.body.has_more, true)
  assert.deepEqual(firstInboxPage.body.threads.map((thread) => thread.id), ['fixture-inbox-first'])
  const lastInboxPage = await adminGet(`${inbox}&scope=waiting&priority=urgent&query=Inbox%20unique&limit=1&page=2`)
  assert.equal(lastInboxPage.body.has_more, false)
  assert.deepEqual(lastInboxPage.body.threads.map((thread) => thread.id), ['fixture-inbox-second'])
  const blockedInbox = await adminGet(`${inbox}&status=blocked&query=Inbox%20unique`)
  assert.deepEqual(blockedInbox.body.threads.map((thread) => [thread.id, thread.status]), [['fixture-inbox-blocked', 'blocked']])
  const literalInboxSearch = await adminGet(`${inbox}&status=awaiting_support&query=${encodeURIComponent('100%_')}`)
  assert.deepEqual(literalInboxSearch.body.threads.map((thread) => thread.id), ['fixture-inbox-first'])
  const ticketId = 'fixture-inbox-first'
  let legacyTicketHash = 0
  for (const character of ticketId) legacyTicketHash = (legacyTicketHash * 31 + character.charCodeAt(0)) >>> 0
  const legacyTicketReference = `SAT-2026-${String(legacyTicketHash % 1000000).padStart(6, '0')}`
  const emailTicketReference = `SAT-2026-${ticketId.replaceAll('-', '').slice(-6).toUpperCase()}`
  await db.prepare("UPDATE support_threads SET updated_at = '2027-01-01 12:00:00' WHERE id = ?1").bind(ticketId).run()
  for (const reference of [legacyTicketReference, emailTicketReference, legacyTicketReference.replace('2026', '2027')]) {
    const matching = await adminGet(`${inbox}&query=${encodeURIComponent(reference)}`)
    assert.equal(matching.response.status, 200)
    assert.deepEqual(matching.body.threads.map((thread) => thread.id), [ticketId])
  }
  const inboxLookup = await adminGet(`${inbox}&thread_id=fixture-inbox-first`)
  assert.equal(inboxLookup.body.threads[0].status, 'awaiting_support')
  assert.equal((await db.prepare("SELECT admin_last_read_at FROM support_threads WHERE id = 'fixture-inbox-first'").first()).admin_last_read_at, null)
  assert.equal((await adminGet(`${inbox}&thread_id=fixture-not-found`)).response.status, 404)
  assert.equal((await adminGet(`${inbox}&priority=invalid`)).response.status, 400)
  assert.equal((await adminGet(`${inbox}&limit=51`)).response.status, 400)
  const insertMessage = db.prepare(`INSERT INTO support_messages
    (id, thread_id, sender, sender_role, body, created_at)
    VALUES (?1, ?2, ?3, ?4, 'Fixture', '2026-11-01 12:00:00')`)
  await db.batch([
    insertMessage.bind('fixture-first-customer', ticketId, 'user', 'customer'),
    insertMessage.bind('fixture-first-note', ticketId, 'admin', 'internal_note'),
    insertMessage.bind('fixture-second-customer', 'fixture-inbox-second', 'user', 'customer'),
  ])
  const supportRead = '/v1/admin/support/read'
  const readStatus = async (id) => (await db.prepare('SELECT admin_read_at FROM support_messages WHERE id = ?1').bind(id).first()).admin_read_at
  const unreadAt = async (id) => (await adminGet(`${inbox}&thread_id=${id}`)).body.threads[0].unread_count
  const conversation = await adminGet(`/v1/admin/support/conversation?thread_id=${ticketId}`)
  assert.equal(conversation.response.status, 200)
  assert.equal(conversation.body.thread.id, ticketId)
  assert.deepEqual(conversation.body.unread_message_ids, ['fixture-first-customer'])
  assert.equal(conversation.body.audit, undefined)
  assert.equal(await readStatus('fixture-first-customer'), null)
  await insertMessage.bind('fixture-first-late', ticketId, 'user', 'email_inbound').run()
  assert.equal(await unreadAt(ticketId), 2)
  const receipt = { thread_id: ticketId, message_ids: [...conversation.body.unread_message_ids, 'fixture-first-note', 'fixture-second-customer'] }
  assert.equal((await mf.dispatchFetch(`https://api.saturnws.com${supportRead}`, { method: 'POST', body: JSON.stringify(receipt) })).status, 401)
  assert.equal((await adminPost(supportRead, { ...receipt, message_ids: [true] })).response.status, 400)
  assert.equal((await adminPost(supportRead, { ...receipt, message_ids: Array(101).fill('fixture-first-late') })).response.status, 400)
  assert.equal((await adminPost(supportRead, { ...receipt, thread_id: 'fixture-missing' })).response.status, 404)
  assert.equal((await adminPost(supportRead, receipt)).response.status, 200)
  const marked = await readStatus('fixture-first-customer')
  assert.ok(marked)
  assert.equal((await adminPost(supportRead, receipt)).response.status, 200)
  assert.equal(await readStatus('fixture-first-customer'), marked)
  assert.equal(await readStatus('fixture-first-note'), null)
  assert.equal(await readStatus('fixture-second-customer'), null)
  assert.equal(await readStatus('fixture-first-late'), null)
  assert.equal(await unreadAt(ticketId), 1)

  const insertEvent = db.prepare(`INSERT INTO support_audit_events (id, thread_id, event_type, actor_role, created_at)
    VALUES (?1, ?2, 'priority_changed', 'admin', ?3)`)
  const historyIds = Array.from({ length: 231 }, (_, index) => `fixture-history-${String(index).padStart(3, '0')}`)
  await db.batch(historyIds.map((id) => insertEvent.bind(id, ticketId, '2026-11-01 12:00:00')))
  const history = `/v1/admin/support/history?thread_id=${ticketId}`
  assert.equal((await mf.dispatchFetch(`https://api.saturnws.com${history}`)).status, 401)
  assert.equal((await adminGet('/v1/admin/support/history?thread_id=fixture-missing')).response.status, 404)
  assert.equal((await adminGet('/v1/admin/support/history?thread_id=fixture-inbox-second&cursor=fixture-history-230')).response.status, 400)
  let next = null
  const seenHistory = []
  for (let page = 0; page < 10; page++) {
    const result = await adminGet(history + (next ? `&cursor=${next}` : ''))
    assert.equal(result.response.status, 200)
    assert.equal(result.body.thread_id, ticketId)
    assert.equal(result.body.events.length, page === 9 ? 6 : 25)
    assert.deepEqual(Object.keys(result.body.events[0]).sort(), ['actor_role', 'created_at', 'event_type', 'id'])
    seenHistory.push(...result.body.events.map(({ id }) => id))
    next = result.body.next_cursor
    if (page === 0) await insertEvent.bind('fixture-history-232', ticketId, '2026-11-01T12:00:00.100Z').run()
  }
  assert.equal(next, null)
  assert.deepEqual(seenHistory, [...historyIds].reverse())
  assert.equal((await adminGet(history)).body.events[0].id, 'fixture-history-232')
  assert.equal(await unreadAt(ticketId), 1, 'History never changes read status')
  const noteResult = await adminPost('/v1/admin/support/reply', { thread_id: ticketId, body: 'Fixture note', internal_note: true, idempotency_key: 'fixture-unread-note' })
  assert.equal(noteResult.response.status, 200)
  assert.equal(await unreadAt(ticketId), 1, 'A note must not clear unseen messages')
  const legacyConversation = await adminGet(`/v1/admin/support/messages?thread_id=${ticketId}`)
  assert.equal(legacyConversation.body.audit.length, 200)
  assert.equal(typeof legacyConversation.body.audit.at(-1).metadata_json, 'string')
  assert.equal(legacyConversation.body.audit.at(-1).event_type, 'internal_note_added')
  assert.ok(legacyConversation.body.audit.some(({ id }) => id === 'fixture-history-232'))
  assert.ok(await readStatus('fixture-first-late'), 'The old client still acknowledges only the returned messages')
  assert.equal(await unreadAt(ticketId), 0)
  console.log('PASS Support exact read receipts, same-second arrivals, cross-ticket isolation, old-client compatibility, and 231-event history pagination during concurrent insertion')
  const logInsert = db.prepare(`INSERT INTO email_jobs
    (id, idempotency_key, email_type, recipient, sender, subject, status, html_body, text_body, template_data_json, headers_json, sensitive_payload_ciphertext, created_at)
    VALUES (?1, ?1, 'admin.email_test', 'fixture-log@example.test', 'fixture@example.test', ?2, ?3, 'fixture-private-html', 'fixture-private-text', 'fixture-private-template', 'fixture-private-header', 'fixture-private-ciphertext', '2026-01-01 00:00:00')`)
  await db.batch(Array.from({ length: 130 }, (_, index) => logInsert.bind(`fixture-log-${String(index).padStart(3, '0')}`, index === 0 ? 'Literal 100%_ fixture' : 'Fixture log', index % 2 ? 'failed' : 'sent')))
  const activityPath = '/v1/admin/email/activity?view=outbound&query=fixture-log'
  assert.equal((await mf.dispatchFetch(`https://api.saturnws.com${activityPath}`)).status, 401)
  const activityIds = []
  for (let page = 1; page <= 6; page++) {
    const result = await adminGet(`${activityPath}&page=${page}`)
    assert.equal(result.response.status, 200)
    assert.equal(result.body.page, page)
    assert.equal(result.body.has_more, page < 6)
    assert.equal(result.body.items.length, page < 6 ? 25 : 5)
    assert.doesNotMatch(JSON.stringify(result.body), /fixture-private|html_body|headers_json|sensitive_payload_ciphertext/)
    activityIds.push(...result.body.items.map((item) => item.id))
  }
  assert.equal(new Set(activityIds).size, 130)
  assert.equal(activityIds[0], 'fixture-log-129')
  const filteredActivity = await adminGet(`${activityPath}&status=failed&limit=100`)
  assert.equal(filteredActivity.body.items.length, 65)
  assert.ok(filteredActivity.body.items.every((item) => item.status === 'failed'))
  const literalActivity = await adminGet(`/v1/admin/email/activity?view=outbound&query=${encodeURIComponent('100%_')}`)
  assert.deepEqual(literalActivity.body.items.map((item) => item.id), ['fixture-log-000'])
  for (const query of ['view=invalid', 'view=__proto__', 'limit=101', 'limit=-1', 'limit=0', 'page=1.5', 'page=10001', 'query=' + 'x'.repeat(201), 'view=inbound&job_id=fixture-log-000']) {
    assert.equal((await adminGet('/v1/admin/email/activity?' + query)).response.status, 400)
  }
  for (const view of ['inbound', 'scheduled', 'events', 'flags']) {
    const result = await adminGet('/v1/admin/email/activity?view=' + view)
    assert.equal(result.response.status, 200)
    assert.equal(result.body.view, view)
    assert.ok(Array.isArray(result.body.items))
    assert.doesNotMatch(JSON.stringify(result.body), /html_sanitized|text_body|attachments_json|payload_json/)
  }
  const eventInsert = db.prepare("INSERT INTO email_events (id, provider_event_id, event_type, email_job_id, payload_json) VALUES (?1, ?1, 'email.sent', ?2, 'fixture-private-event-payload')")
  await db.batch([eventInsert.bind('fixture-selected-event', 'fixture-log-001'), eventInsert.bind('fixture-unrelated-event', 'fixture-log-002')])
  const jobDetail = await adminGet('/v1/admin/email/jobs/fixture-log-001')
  assert.equal(jobDetail.body.job.id, 'fixture-log-001')
  assert.equal(jobDetail.body.job.retry_allowed, true)
  assert.deepEqual(jobDetail.body.events.map((event) => event.id), ['fixture-selected-event'])
  assert.doesNotMatch(JSON.stringify(jobDetail.body), /fixture-private|fixture-unrelated-event/)
  assert.equal((await adminGet('/v1/admin/email/jobs/fixture-job-not-found')).response.status, 404)
  const exactEvents = await adminGet('/v1/admin/email/activity?view=events&job_id=fixture-log-001')
  assert.deepEqual(exactEvents.body.items.map((event) => event.id), ['fixture-selected-event'])
  const countsBeforeConfig = await db.prepare('SELECT count(*) AS count FROM email_jobs').first()
  const emailConfig = await adminGet('/v1/admin/email/status?view=configuration')
  assert.equal(emailConfig.response.status, 200)
  assert.equal(emailConfig.body.config.outbound_enabled, true)
  assert.ok(emailConfig.body.catalog.length > 0)
  assert.equal(emailConfig.body.jobs, undefined)
  assert.equal(emailConfig.body.inbound, undefined)
  assert.doesNotMatch(JSON.stringify(emailConfig.body), /local-send-key|local-receive-key|fixture-private/)
  assert.equal((await db.prepare('SELECT count(*) AS count FROM email_jobs').first()).count, countsBeforeConfig.count)
  await db.exec('ALTER TABLE email_events RENAME TO email_events_unavailable_fixture')
  const partialDetail = await adminGet('/v1/admin/email/jobs/fixture-log-001')
  assert.equal(partialDetail.response.status, 200)
  assert.equal(partialDetail.body.events_unavailable, true)
  assert.equal(partialDetail.body.job.id, 'fixture-log-001')
  assert.equal((await adminGet('/v1/admin/email/activity?view=events')).response.status, 503)
  await db.exec('ALTER TABLE email_jobs RENAME TO email_jobs_unavailable_fixture')
  const unavailableActivity = await adminGet(activityPath)
  assert.equal(unavailableActivity.response.status, 503)
  assert.deepEqual(unavailableActivity.body, { success: false, error: 'email_activity_unavailable' })
  assert.equal((await adminGet('/v1/admin/email/jobs/fixture-log-001')).response.status, 503)
  console.log('PASS Email metadata pagination, literal search, exact-job events, suppression, payload privacy, directed processing, and unavailable-source behavior')
  await db.exec('ALTER TABLE support_audit_events RENAME TO support_audit_events_unavailable_fixture')
  assert.equal((await adminGet(history)).response.status, 503)
  assert.equal((await adminGet(`/v1/admin/support/conversation?thread_id=${ticketId}`)).response.status, 200)
  const legacyWithoutHistory = await adminGet(`/v1/admin/support/messages?thread_id=${ticketId}`)
  assert.equal(legacyWithoutHistory.response.status, 200)
  assert.equal(legacyWithoutHistory.body.audit_unavailable, true)
  await db.exec('ALTER TABLE support_messages RENAME TO support_messages_unavailable_fixture')
  const unavailableConversation = await adminGet('/v1/admin/support/messages?thread_id=fixture-inbox-second')
  assert.equal(unavailableConversation.response.status, 503)
  assert.equal((await db.prepare("SELECT admin_last_read_at FROM support_threads WHERE id = 'fixture-inbox-second'").first()).admin_last_read_at, null)
  await db.exec('ALTER TABLE support_threads RENAME TO support_threads_unavailable_fixture')
  const unavailableInbox = await adminGet(inbox)
  assert.equal(unavailableInbox.response.status, 503)
  assert.deepEqual(unavailableInbox.body, { success: false, error: 'support_inbox_unavailable' })

  console.log('Support, inbox pagination and recovery, notification, webhook, idempotency, ownership, rate-limit, and lock checks passed.')
} finally {
  await mf.dispose()
  await rm(temp, { recursive: true, force: true })
}
