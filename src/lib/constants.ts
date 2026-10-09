// Shared lists. Branch names can be edited here without touching any screen.

// Departments as listed on jecjabalpur.ac.in (Oct 2026). Add older department names here if earlier batches need them.
export const BRANCHES = [
  'Civil Engineering',
  'Computer Science & Engineering',
  'Electrical Engineering',
  'Electronics & Telecommunication Engineering',
  'Industrial & Production Engineering',
  'Information Technology',
  'Mechanical Engineering',
  'Mechatronics',
  'Artificial Intelligence & Data Science',
  'MCA',
  'M.Tech. / M.E.',
  'M.Sc. (Applied Sciences)',
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

const BRANCH_SHORT: Record<string, string> = {
  'Civil Engineering': 'Civil',
  'Computer Science & Engineering': 'CSE',
  'Electrical Engineering': 'Electrical',
  'Electronics & Telecommunication Engineering': 'E&TC',
  'Industrial & Production Engineering': 'IPE',
  'Information Technology': 'IT',
  'Mechanical Engineering': 'Mechanical',
  'Artificial Intelligence & Data Science': 'AI & DS',
  'M.Sc. (Applied Sciences)': 'M.Sc.',
}

/** Short branch name for tight list rows ("CSE" instead of "Computer Science & Engineering"). */
export function shortBranch(branch: string | null | undefined): string | null {
  if (!branch) return null
  return BRANCH_SHORT[branch] ?? branch
}
