// Shared lists. Branch names can be edited here without touching any screen.

export const BRANCHES = [
  'Civil Engineering',
  'Mechanical Engineering',
  'Electrical Engineering',
  'Electronics & Telecommunication Engineering',
  'Electronics & Communication Engineering',
  'Computer Science & Engineering',
  'Information Technology',
  'Industrial & Production Engineering',
  'Architecture',
  'MCA',
  'M.E. / M.Tech.',
  'Other',
] as const

export const TSHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'] as const

export const FOOD_PREFS = [
  { value: 'veg', label: 'Vegetarian' },
  { value: 'non_veg', label: 'Non-vegetarian' },
  { value: 'jain', label: 'Jain' },
] as const

export const MEMBER_TYPES = [
  { value: 'alumnus', label: 'Alumnus / Alumna', hint: 'I studied at JEC' },
  { value: 'student', label: 'Current student', hint: 'I study at JEC now' },
  { value: 'faculty', label: 'Faculty or staff', hint: 'I teach or work at JEC' },
] as const

export const HELP_TAGS = [
  'Referrals',
  'Career guidance',
  'Mock interviews',
  'Higher studies',
  'Startups',
  'Government jobs',
  'Hiring',
] as const

export const MEET_SLUG = 'alumni-meet-2026'

export function yearRange(from: number, to: number): number[] {
  const out: number[] = []
  for (let y = to; y >= from; y--) out.push(y)
  return out
}

export const CURRENT_YEAR = new Date().getFullYear()
