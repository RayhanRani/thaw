export type Side = 'merchant' | 'admin'

export type Route = { kind: 'landing' } | { kind: 'app'; side: Side }

export function parseRoute(hash: string): Route {
  const side = hash.replace(/^#\/?/, '').split('/')[0]
  if (side === 'merchant' || side === 'admin') return { kind: 'app', side }
  return { kind: 'landing' }
}

export function href(side: Side | 'landing'): string {
  return side === 'landing' ? '#/' : `#/${side}`
}
