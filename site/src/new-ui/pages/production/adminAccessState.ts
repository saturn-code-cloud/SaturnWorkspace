import { ApiError } from '../../../api/http'
import type { AdminAdapter } from '../../adapters/contracts'
import type { AdminSession } from '../../../api/admin'

export type AdminAccessState =
  | { status: 'checking' | 'preauth' | 'signin' | 'unavailable' }
  | { status: 'denied'; reason: 'unverified' | 'permission' | 'origin' }
  | { status: 'ready'; session: AdminSession }

export function adminAccessFailure(error: unknown): AdminAccessState {
  if (!(error instanceof ApiError)) return { status: 'unavailable' }
  if (['admin_allowlist_empty', 'firebase_not_configured', 'admin_identity_unavailable'].includes(error.message)) return { status: 'unavailable' }
  if (error.message === 'firebase_email_not_verified') return { status: 'denied', reason: 'unverified' }
  if (error.message.startsWith('admin_email_not_allowed') || error.message === 'admin_permission_denied') return { status: 'denied', reason: 'permission' }
  if (['forbidden_origin', 'origin_not_allowed'].includes(error.message)) return { status: 'denied', reason: 'origin' }
  if (error.status === 401) return { status: error.message === 'preauth_required' ? 'preauth' : 'signin' }
  if (error.status === 403) return { status: 'denied', reason: 'permission' }
  return { status: 'unavailable' }
}

export async function readAdminAccess(admin: Pick<AdminAdapter, 'getPreauthState' | 'getSession'>, signal: AbortSignal): Promise<AdminAccessState> {
  signal.throwIfAborted()
  let preauth
  try { preauth = await admin.getPreauthState(signal) }
  catch (error) {
    signal.throwIfAborted()
    const failure = adminAccessFailure(error)
    return failure.status === 'denied' ? failure : { status: 'unavailable' }
  }
  signal.throwIfAborted()
  if (!preauth.authenticated) return { status: 'preauth' }
  try {
    const session = await admin.getSession(signal)
    signal.throwIfAborted()
    return { status: 'ready', session }
  } catch (error) {
    signal.throwIfAborted()
    return adminAccessFailure(error)
  }
}

export type AdminLoginIssue = 'credentials' | 'rate' | 'popup' | 'cancelled' | 'connection'
export function adminLoginIssue(error: unknown): AdminLoginIssue {
  const message = error instanceof Error ? error.message : ''
  if (error instanceof ApiError && error.status === 401 && message === 'invalid_credentials') return 'credentials'
  if ((error instanceof ApiError && error.status === 429) || message === 'AUTH_TOO_MANY_ATTEMPTS') return 'rate'
  if (message.includes('popup-blocked')) return 'popup'
  if (message.includes('popup-closed-by-user') || message.includes('cancelled-popup-request')) return 'cancelled'
  return 'connection'
}
