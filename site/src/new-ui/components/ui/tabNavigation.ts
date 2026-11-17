export function nextTabTarget(items: readonly { id: string; disabled?: boolean }[], current: string, key: string, rtl: boolean): string | null {
  const available = items.filter((item) => !item.disabled)
  const index = available.findIndex((item) => item.id === current)
  if (index < 0) return null
  let next: number
  if (key === 'Home') next = 0
  else if (key === 'End') next = available.length - 1
  else if (key === 'ArrowRight') next = index + (rtl ? -1 : 1)
  else if (key === 'ArrowLeft') next = index + (rtl ? 1 : -1)
  else return null
  return available[(next + available.length) % available.length].id
}
