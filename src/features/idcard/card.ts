// Digital alumni ID card: pure helpers (no React, no network).

/** JEC-2008-000123; JEC-000123 when the batch is unknown. Mirrors public.membership_no() in the database. */
export function formatMembershipNo(gradYear: number | null | undefined, serial: number | null | undefined): string | null {
  if (serial === null || serial === undefined || !Number.isFinite(serial) || serial <= 0) return null
  const n = Math.trunc(serial)
  const digits = n < 1_000_000 ? String(n).padStart(6, '0') : String(n)
  return `JEC-${gradYear ? `${gradYear}-` : ''}${digits}`
}

/** Card tokens are 32 lower-case hex characters. Anything else is rejected before a network call. */
export function normaliseCardToken(raw: string | null | undefined): string | null {
  if (!raw) return null
  const t = raw.trim().toLowerCase()
  return /^[0-9a-f]{32}$/.test(t) ? t : null
}

/** The address the QR code opens (the page itself is built in the UI phase). */
export function cardVerifyUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/verify/${token}`
}

/** Pulls the token out of a scanned QR (a full verify URL or the bare token). */
export function tokenFromScan(text: string): string | null {
  const m = /\/verify\/([0-9a-fA-F]{32})(?:[/?#]|$)/.exec(text.trim())
  return normaliseCardToken(m ? m[1] : text)
}

export type CardRole = 'owner' | 'admin' | 'organiser' | 'moderator' | 'batch_rep' | 'department_head' | 'mentor'

export const CARD_ROLE_LABELS: Record<CardRole, { en: string; hi: string }> = {
  owner: { en: 'Founder admin', hi: 'संस्थापक एडमिन' },
  admin: { en: 'Admin', hi: 'एडमिन' },
  organiser: { en: 'Organiser', hi: 'आयोजक' },
  moderator: { en: 'Moderator', hi: 'मॉडरेटर' },
  batch_rep: { en: 'Batch Representative', hi: 'बैच प्रतिनिधि' },
  department_head: { en: 'Department Head', hi: 'विभाग प्रमुख' },
  mentor: { en: 'Mentor', hi: 'मेंटर' },
}

/** The most important role first, unknown keys dropped. 'admin' is folded into 'owner' when both are present. */
export function cardRoles(keys: readonly string[] | null | undefined): CardRole[] {
  const order: CardRole[] = ['owner', 'admin', 'organiser', 'batch_rep', 'department_head', 'moderator', 'mentor']
  const set = new Set(keys ?? [])
  if (set.has('owner')) set.delete('admin')
  return order.filter((r) => set.has(r))
}
