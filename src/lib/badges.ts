import type { Registration, RegistrationStatus } from './types'

// Name badges: one for the registrant and one for each named guest, from the registration data.

export interface BadgeSpec {
  key: string
  name: string
  /** "Alumnus", "Spouse", "Guest"… */
  role: string
  /** "CSE 2005" */
  batch: string
  city: string
  code: string
  /** for guests: whose guest they are */
  host: string | null
  food: string | null
}

type BadgeSource = Pick<Registration, 'id' | 'code' | 'status' | 'full_name' | 'branch' | 'grad_year' | 'city' | 'guests' | 'food_pref'>

const FOOD: Record<string, string> = { veg: 'Veg', non_veg: 'Non-veg', jain: 'Jain' }

export function buildBadges(
  regs: BadgeSource[],
  opts: { statuses: RegistrationStatus[]; includeGuests: boolean; only?: ReadonlySet<string> | null; sort?: 'name' | 'batch' } = { statuses: ['confirmed'], includeGuests: true },
): BadgeSpec[] {
  const chosen = regs.filter((r) => opts.statuses.includes(r.status) && (!opts.only || opts.only.has(r.id)))
  chosen.sort((a, b) => (opts.sort === 'batch' ? (a.grad_year ?? 9999) - (b.grad_year ?? 9999) || a.full_name.localeCompare(b.full_name) : a.full_name.localeCompare(b.full_name)))
  const out: BadgeSpec[] = []
  for (const r of chosen) {
    const batch = [r.branch ? short(r.branch) : '', r.grad_year ?? ''].filter(Boolean).join(' ')
    const food = r.food_pref ? (FOOD[r.food_pref] ?? null) : null
    out.push({ key: r.id, name: r.full_name, role: 'Alumnus', batch, city: r.city ?? '', code: r.code, host: null, food })
    if (opts.includeGuests) {
      r.guests.forEach((g, i) => {
        const name = (g.name ?? '').trim() || `Guest of ${r.full_name}`
        out.push({ key: `${r.id}:${i}`, name, role: (g.relation ?? '').trim() || 'Guest', batch: '', city: '', code: r.code, host: r.full_name, food })
      })
    }
  }
  return out
}

/** "Computer Science & Engineering" -> "CSE" (first letters of the words that start with a capital); short names stay as they are. */
export function short(branch: string): string {
  if (branch.length <= 6) return branch
  const letters = branch.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join('')
  return letters.length >= 2 ? letters : branch
}

/** Splits badges into sheets of n (printed one sheet per page). */
export function paginate<T>(items: T[], perPage: number): T[][] {
  const pages: T[][] = []
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage))
  return pages
}
