const ACTIVATION_STORAGE_KEY = 'saturnws.activation.payload.v1'

export type ActivationPayload = {
  ticket: string
  legacyCode?: string
}

export function activationFromQuery(search?: string): ActivationPayload | null {
  const params = new URLSearchParams(search)
  const ticket = (params.get('ticket') || params.get('device_code') || '').trim()
  const legacyCode = (params.get('code') || '').trim().toUpperCase()
  return ticket || legacyCode ? { ticket, legacyCode: legacyCode || undefined } : null
}

export function readActivationPayload(search?: string): ActivationPayload | null {
  const incoming = activationFromQuery(search)
  if (incoming) return incoming
  try {
    const raw = window.sessionStorage.getItem(ACTIVATION_STORAGE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as Partial<ActivationPayload>
    const ticket = typeof saved.ticket === 'string' ? saved.ticket.trim() : ''
    const legacyCode = typeof saved.legacyCode === 'string' ? saved.legacyCode.trim().toUpperCase() : ''
    return ticket || legacyCode ? { ticket, legacyCode: legacyCode || undefined } : null
  } catch {
    return null
  }
}

export function rememberActivationPayload(payload: ActivationPayload): boolean {
  try {
    window.sessionStorage.setItem(ACTIVATION_STORAGE_KEY, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

export function clearActivationPayload() {
  try {
    window.sessionStorage.removeItem(ACTIVATION_STORAGE_KEY)
  } catch {
    // Storage may be unavailable in restricted browsing modes.
  }
}
