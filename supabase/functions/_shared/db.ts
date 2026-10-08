// Minimal Supabase REST/Auth client (plain fetch, no npm download at cold start).
const URL_ = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

export interface Db {
  select<T>(table: string, query: string): Promise<T[]>
  update(table: string, query: string, patch: Record<string, unknown>): Promise<void>
  upsert(table: string, row: Record<string, unknown>): Promise<void>
}

function client(key: string, bearer: string): Db {
  const headers = { apikey: key, Authorization: bearer, 'Content-Type': 'application/json' }
  return {
    async select<T>(table: string, query: string) {
      const res = await fetch(`${URL_}/rest/v1/${table}?${query}`, { headers })
      if (!res.ok) throw new Error(`DB ${table}: ${res.status} ${await res.text()}`)
      return (await res.json()) as T[]
    },
    async update(table: string, query: string, patch: Record<string, unknown>) {
      const res = await fetch(`${URL_}/rest/v1/${table}?${query}`, { method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(patch) })
      if (!res.ok) throw new Error(`DB ${table}: ${res.status} ${await res.text()}`)
    },
    async upsert(table: string, row: Record<string, unknown>) {
      const res = await fetch(`${URL_}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(row),
      })
      if (!res.ok) throw new Error(`DB ${table}: ${res.status} ${await res.text()}`)
    },
  }
}

/** Queries run as the signed-in member, so row-level security applies. */
export const asUser = (authorization: string) => client(ANON, authorization)
/** Server-side only: bypasses row-level security. */
export const asService = () => client(SERVICE, `Bearer ${SERVICE}`)

export async function currentUser(authorization: string | null): Promise<{ id: string } | null> {
  if (!authorization?.startsWith('Bearer ')) return null
  const res = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: authorization } })
  if (!res.ok) return null
  const u = (await res.json()) as { id?: string }
  return u.id ? { id: u.id } : null
}

export const eq = (v: string) => `eq.${encodeURIComponent(v)}`
