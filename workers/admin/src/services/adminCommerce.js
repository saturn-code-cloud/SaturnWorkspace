import { supabaseJson, supabasePage } from './supabase.js'
import { paymentProviderState } from './orders.js'

export const ORDER_STATES = ['creating', 'provider_unavailable', 'awaiting_payment', 'confirming', 'paid', 'underpaid', 'overpaid', 'expired', 'failed', 'cancelled', 'refunded', 'manual_review']
const ORDER_FIELDS = 'id,firebase_uid,user_email,plan_id,plan_version,status,currency,amount_minor,provider,provider_order_id,created_at,updated_at,expires_at'
const PLAN_FIELDS = 'plan_id,version,display_name,term,price_minor,original_price_minor,currency,active,public_visible,purchasable,provider,trial_days,config_status,updated_at'
const INTEGRITY_FIELDS = 'id,firebase_uid,subscription_id,code,severity,source,resolved_at,created_at'
const RELATIONS = {
  attempts: { table: 'payment_attempts', select: 'id,order_id,provider,provider_payment_id,status,requested_amount_minor,received_amount_minor,currency,created_at,updated_at', at: 'created_at' },
  events: { table: 'payment_provider_events', select: 'id,order_id,provider,provider_event_id,event_type,signature_verified,processing_status,received_at,processed_at,error_code', at: 'received_at' },
  receipts: { table: 'payment_receipts', select: 'id,order_id,provider_receipt_id,document_type,issued_at,created_at', at: 'created_at' },
}
const uuid = (value) => /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
const project = (row, fields) => Object.fromEntries(fields.split(',').map((key) => [key, row[key] ?? null]))
const filterValue = (value) => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
const contains = (value) => 'ilike.' + filterValue('%' + value.replace(/[\\%_*]/g, '\\$&') + '%')
function pageInput(params) {
  const raw = params.get('page') || '1'; const page = Number(raw)
  const query = (params.get('query') || '').trim()
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(page) || page < 1 || page > 5000 || query.length > 100) throw new Error('invalid_commerce_query')
  return { page, limit: 25, query, status: (params.get('status') || '').trim() }
}
async function read(env, table, params) {
  try {
    const rows = await supabaseJson(env, `/${table}?${params}`, { signal: AbortSignal.timeout(12000) })
    if (!Array.isArray(rows)) throw new Error('invalid_commerce_rows')
    return rows
  } catch { throw new Error('commerce_unavailable') }
}
async function readPage(env, table, params) {
  try {
    const result = await supabasePage(env, `/${table}?${params}`, { signal: AbortSignal.timeout(12000) })
    if (result.items.length !== Math.min(Number(params.get('limit')), Math.max(0, result.total - Number(params.get('offset') || 0)))) throw new Error('invalid_commerce_count')
    return result
  } catch { throw new Error('commerce_unavailable') }
}
export async function listCommerceOrders(env, params) {
  const input = pageInput(params)
  if (input.status && !ORDER_STATES.includes(input.status)) throw new Error('invalid_commerce_query')
  const query = new URLSearchParams({ select: ORDER_FIELDS, order: 'created_at.desc,id.desc', limit: String(input.limit), offset: String((input.page - 1) * input.limit) })
  if (input.query) {
    if (uuid(input.query)) query.set('id', 'eq.' + input.query)
    else query.set('user_email', contains(input.query))
  }
  if (input.status) query.set('status', 'eq.' + input.status)
  const { items, total } = await readPage(env, 'commercial_orders', query)
  if (items.some((row) => !row || !uuid(row.id) || !ORDER_STATES.includes(row.status) || !Number.isSafeInteger(row.amount_minor) || row.amount_minor < 0 || !/^[A-Z]{3}$/.test(row.currency || '') || !Number.isFinite(Date.parse(row.created_at)))) throw new Error('commerce_unavailable')
  return { success: true, view: 'orders', ...input, total, items: items.map((row) => project(row, ORDER_FIELDS)), has_more: input.page * input.limit < total, generated_at: new Date().toISOString() }
}
export async function listCommercePlans(env, params) {
  const input = pageInput(params)
  if (input.status && !['visible', 'hidden', 'inactive'].includes(input.status)) throw new Error('invalid_commerce_query')
  const query = new URLSearchParams({ select: PLAN_FIELDS, order: 'plan_id.asc,version.desc', limit: String(input.limit), offset: String((input.page - 1) * input.limit) })
  if (input.query) query.set('plan_id', contains(input.query))
  if (input.status === 'visible') { query.set('active', 'eq.true'); query.set('public_visible', 'eq.true') }
  if (input.status === 'hidden') { query.set('active', 'eq.true'); query.set('public_visible', 'eq.false') }
  if (input.status === 'inactive') query.set('active', 'eq.false')
  const { items, total } = await readPage(env, 'commercial_plans', query)
  if (items.some((row) => !row || !row.plan_id || !Number.isSafeInteger(row.version) || !Number.isSafeInteger(row.price_minor) || row.price_minor < 0 || !/^[A-Z]{3}$/.test(row.currency || '') || ['active', 'public_visible', 'purchasable'].some((key) => typeof row[key] !== 'boolean'))) throw new Error('commerce_unavailable')
  return { success: true, view: 'plans', ...input, total, items: items.map((row) => ({ ...project(row, PLAN_FIELDS), checkout_available: paymentProviderState(env, row.provider).available })), has_more: input.page * input.limit < total, generated_at: new Date().toISOString() }
}
export async function listCommerceIntegrity(env, params) {
  const input = pageInput(params)
  if (input.status && !['open', 'resolved'].includes(input.status)) throw new Error('invalid_commerce_query')
  const query = new URLSearchParams({ select: INTEGRITY_FIELDS, order: 'created_at.desc,id.desc', limit: String(input.limit), offset: String((input.page - 1) * input.limit) })
  if (input.status !== 'resolved') query.set('resolved_at', 'is.null'); else query.set('resolved_at', 'not.is.null')
  if (input.query) query.set('firebase_uid', 'eq.' + filterValue(input.query))
  const { items, total } = await readPage(env, 'subscription_integrity_events', query)
  if (items.some((row) => !row || !uuid(row.id) || !row.code || !['info', 'warning', 'critical'].includes(row.severity) || !Number.isFinite(Date.parse(row.created_at)))) throw new Error('commerce_unavailable')
  return { success: true, view: 'integrity', ...input, status: input.status || 'open', total, items: items.map((row) => project(row, INTEGRITY_FIELDS)), has_more: input.page * input.limit < total, generated_at: new Date().toISOString() }
}
export async function getCommerceOrder(env, id, params) {
  if (!uuid(id)) throw new Error('order_not_found')
  const input = pageInput(params)
  const view = params.get('view') || 'attempts'
  if (!Object.hasOwn(RELATIONS, view)) throw new Error('invalid_commerce_query')
  const orders = await read(env, 'commercial_orders', new URLSearchParams({ select: ORDER_FIELDS, id: 'eq.' + id, limit: '1' }))
  if (!orders[0]) throw new Error('order_not_found')
  const order = orders[0]
  if (order.id !== id || !ORDER_STATES.includes(order.status) || !Number.isSafeInteger(order.amount_minor) || !/^[A-Z]{3}$/.test(order.currency || '')) throw new Error('commerce_unavailable')
  const relation = RELATIONS[view]
  let records = null; let unavailable = false; let hasMore = false; let total = null
  try {
    const result = await readPage(env, relation.table, new URLSearchParams({ select: relation.select, order_id: 'eq.' + id, order: relation.at + '.desc,id.desc', limit: String(input.limit), offset: String((input.page - 1) * input.limit) }))
    if (result.items.some((row) => !row || !uuid(row.id) || row.order_id !== id || !Number.isFinite(Date.parse(row[relation.at])) ||
      (view === 'attempts' && (!Number.isSafeInteger(row.requested_amount_minor) || (row.received_amount_minor !== null && !Number.isSafeInteger(row.received_amount_minor)) || !/^[A-Z]{3}$/.test(row.currency || ''))) ||
      (view === 'events' && (typeof row.signature_verified !== 'boolean' || !['received', 'processed', 'ignored', 'failed', 'manual_review'].includes(row.processing_status))) ||
      (view === 'receipts' && !['receipt', 'invoice'].includes(row.document_type)))) throw new Error('commerce_unavailable')
    total = result.total; hasMore = input.page * input.limit < total; records = result.items.map((row) => project(row, relation.select))
  } catch { unavailable = true }
  return { success: true, order: project(order, ORDER_FIELDS), view, items: records, unavailable, total, has_more: hasMore, page: input.page, limit: input.limit, generated_at: new Date().toISOString() }
}
export function commerceConfiguration(env) {
  return { success: true, checkout_available: false, providers: Object.fromEntries(['stripe', 'nowpayments'].map((provider) => [provider, paymentProviderState(env, provider)])), generated_at: new Date().toISOString() }
}
