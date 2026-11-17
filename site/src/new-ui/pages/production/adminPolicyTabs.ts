export function adminPolicyTab(state?: string): 'global' | 'versions' | 'invites' | 'plans' {
  const tab = new URLSearchParams(state).get('tab')
  return tab === 'versions' || tab === 'invites' || tab === 'plans' ? tab : 'global'
}
