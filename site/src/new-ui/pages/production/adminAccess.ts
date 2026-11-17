const sectionPermissions: Readonly<Record<string, string>> = {
  overview: 'admin:read',
  users: 'users:read',
  'device-requests': 'users:read',
  subscriptions: 'subscriptions:read',
  commerce: 'commerce:read',
  releases: 'releases:read',
  diagnostics: 'diagnostics:read',
  data: 'diagnostics:read',
  audit: 'audit:read',
  policies: 'policies:read',
  support: 'admin:read',
  communications: 'admin:read',
  promos: 'admin:read',
  readiness: 'admin:read',
  settings: 'admin:read',
}

export function hasAdminPermission(permissions: readonly string[], permission: string) {
  return permissions.includes('*') || permissions.includes(permission)
}

export function canOpenAdminSection(permissions: readonly string[], section: string) {
  return Object.hasOwn(sectionPermissions, section)
    && hasAdminPermission(permissions, sectionPermissions[section])
}
