// Shared lists. Branch names can be edited here without touching any screen.

// The reunion registration form's 14 options (in its order), then newer departments and 'Other' for younger members.
// Older stored names were mapped to these by migration 20261012000018.
export const BRANCHES = [
  'B.E. in Electronics & Telecommunications',
  'B.E. in Computer Science & Engineering',
  'B.E. in Mechanical Engineering',
  'B.E. in Information Technology',
  'B.E. in Electrical Engineering',
  'B.E. in Civil Engineering',
  'B.E. Industrial & Production Engineering',
  'M.E. in Structural Engineering',
  'M.E. in Communication Systems',
  'M.E. in Environmental Engineering',
  'M.E. in High Voltage Engineering',
  'M.E. in Power Systems Engineering',
  'M.E. in Heat Power Engineering / Machine Design',
  'MCA',
  'Artificial Intelligence & Data Science',
  'Mechatronics',
  'M.E. / M.Tech. (other specialisation)',
  'M.Sc. (Applied Sciences)',
  'Other',
] as const

export const TSHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'] as const

export const FOOD_PREFS = [
  { value: 'veg', label: 'Vegetarian' },
  { value: 'non_veg', label: 'Non-vegetarian' },
  { value: 'jain', label: 'Jain' },
  { value: 'none', label: 'No meal / fasting' },
] as const

/** T-shirt sizes with their names ("S – Small"); the reunion form offered Small to Extra-Large, we keep XS–XXXL. */
export const TSHIRT_NAMES: Record<(typeof TSHIRT_SIZES)[number], string> = {
  XS: 'Extra-Small',
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'Extra-Large',
  XXL: '2XL',
  XXXL: '3XL',
}

// Reunion registration answers (values are stored in the database; labels are translated in the UI).
export const ORG_TEAMS = ['core', 'events', 'venue_food', 'transport', 'hospitality', 'media', 'other'] as const
export const PERFORM_TYPES = ['singing', 'dancing', 'band', 'talk', 'poetry', 'comedy', 'other'] as const
export const SPONSOR_LEVELS = ['main', 'co', 'in_kind', 'not_sure'] as const
export const ARRIVAL_MODES = ['train', 'flight', 'road', 'local'] as const
/** Reunion Fund presets in paise (₹1,000 / ₹2,500 / ₹5,000 / ₹10,000); custom amounts ₹100 – ₹10,00,000. */
export const FUND_PRESETS = [100000, 250000, 500000, 1000000] as const
export const FUND_MIN_PAISE = 10000
export const FUND_MAX_PAISE = 100000000
export const QUESTION_KINDS = ['yes_no', 'single', 'multi', 'short_text', 'long_text'] as const

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
  'B.E. in Electronics & Telecommunications': 'E&TC',
  'B.E. in Computer Science & Engineering': 'CSE',
  'B.E. in Mechanical Engineering': 'Mechanical',
  'B.E. in Information Technology': 'IT',
  'B.E. in Electrical Engineering': 'Electrical',
  'B.E. in Civil Engineering': 'Civil',
  'B.E. Industrial & Production Engineering': 'IPE',
  'M.E. in Structural Engineering': 'M.E. Structural',
  'M.E. in Communication Systems': 'M.E. Comm. Systems',
  'M.E. in Environmental Engineering': 'M.E. Environmental',
  'M.E. in High Voltage Engineering': 'M.E. High Voltage',
  'M.E. in Power Systems Engineering': 'M.E. Power Systems',
  'M.E. in Heat Power Engineering / Machine Design': 'M.E. Heat Power / MD',
  'Artificial Intelligence & Data Science': 'AI & DS',
  'M.E. / M.Tech. (other specialisation)': 'M.E. / M.Tech.',
  'M.Sc. (Applied Sciences)': 'M.Sc.',
  // names used before October 2026
  'Civil Engineering': 'Civil',
  'Computer Science & Engineering': 'CSE',
  'Electrical Engineering': 'Electrical',
  'Electronics & Telecommunication Engineering': 'E&TC',
  'Industrial & Production Engineering': 'IPE',
  'Information Technology': 'IT',
  'Mechanical Engineering': 'Mechanical',
}

/** Short branch name for tight list rows ("CSE" instead of "Computer Science & Engineering"). */
export function shortBranch(branch: string | null | undefined): string | null {
  if (!branch) return null
  return BRANCH_SHORT[branch] ?? branch
}
