// The app's fixed lists, copied from src/lib/constants.ts (edge functions are deployed on their own and cannot import
// from src/). src/features/quickprofile/lists.test.ts fails if the two ever drift apart.
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

export const HELP_TAGS = ['Referrals', 'Career guidance', 'Mock interviews', 'Higher studies', 'Startups', 'Government jobs', 'Hiring'] as const

export const MAX_INPUT_CHARS = 12_000
export const MAX_SKILLS = 15
export const MAX_ABOUT = 400
