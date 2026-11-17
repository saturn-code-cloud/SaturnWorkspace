import { readBoundedRequestText } from '../../shared/requestBody.js'
export class PolicyAdminError extends Error { constructor(message: string, public status: number) { super(message) } }
export const policyAdminJson = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
export const POLICY_VERSION = /^v?\d+(?:\.\d+){0,3}(?:[-+][a-zA-Z0-9.-]+)?$/
export async function policyRevision(value: unknown) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
export async function readPolicyAdminInput(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = JSON.parse(await readBoundedRequestText(request, 4096, 'invalid_policy_change', true))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not_object')
    return body as Record<string, unknown>
  } catch { throw new PolicyAdminError('invalid_policy_change', 400) }
}
