// Row shapes returned by Supabase. Keep in sync with supabase/migrations.

export type MemberType = 'student' | 'alumnus' | 'faculty'
export type VerificationStatus = 'pending' | 'verified' | 'rejected'
export type RegistrationStatus = 'pending_payment' | 'under_review' | 'confirmed' | 'cancelled'
export type PaymentStatus = 'submitted' | 'verified' | 'rejected' | 'refunded'
export type StaffRole = 'manager' | 'checkin'
export type FoodPref = 'veg' | 'non_veg' | 'jain' | 'none'
export type TshirtSize = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL' | 'XXXL'

export interface Profile {
  id: string
  full_name: string
  avatar_url: string | null
  headline: string | null
  member_type: MemberType | null
  branch: string | null
  join_year: number | null
  grad_year: number | null
  current_title: string | null
  current_company: string | null
  city: string | null
  country: string | null
  about: string | null
  linkedin_url: string | null
  website_url: string | null
  skills: string[]
  help_tags: string[]
  interests: string[]
  onboarded: boolean
  birth_day: number | null
  birth_month: number | null
  invite_code: string
  invited_by: string | null
  message_policy: 'jec' | 'batch_and_connections' | 'connections'
  language: 'en' | 'hi'
  verification: VerificationStatus
  is_admin: boolean
  created_at: string
  updated_at: string
}

export interface ProfilePrivate {
  id: string
  phone: string | null
  whatsapp_same_as_phone: boolean
}

export interface Experience {
  id: string
  profile_id: string
  title: string
  company: string
  location: string | null
  start_date: string | null
  end_date: string | null
  is_current: boolean
  description: string | null
  source: 'manual' | 'linkedin'
}

export interface Education {
  id: string
  profile_id: string
  school: string
  degree: string | null
  field: string | null
  start_year: number | null
  end_year: number | null
  source: 'manual' | 'linkedin'
}

export interface EventRow {
  id: string
  slug: string
  title: string
  tagline: string | null
  description: string | null
  venue: string | null
  venue_map_url: string | null
  starts_at: string | null
  ends_at: string | null
  registration_closes_at: string | null
  eligible_from_year: number | null
  eligible_to_year: number | null
  capacity: number | null
  upi_id: string | null
  upi_payee_name: string | null
  payment_note: string | null
  contact_phone: string | null
  contact_email: string | null
  cover_url: string | null
  is_published: boolean
  /** registration asks (and requires) the reunion questions */
  ask_reunion_questions: boolean
  updated_at: string
}

export interface TicketType {
  id: string
  event_id: string
  label: string
  description: string | null
  price_paise: number
  is_primary: boolean
  max_per_registration: number
  sort: number
  /** event days this ticket covers (1 = first day); null = every day */
  days: number[] | null
}

export type QuestionKind = 'yes_no' | 'single' | 'multi' | 'short_text' | 'long_text'

/** A question the organisers added to an event's registration. */
export interface EventQuestion {
  id: string
  event_id: string
  kind: QuestionKind
  label: string
  help: string | null
  options: string[]
  required: boolean
  is_active: boolean
  sort: number
}

export type CustomAnswer = boolean | string | string[]

export interface Guest {
  name: string
  /** which ticket this person is on (labels can be renamed later; the id can't) */
  ticket_type_id?: string
  relation?: string
  age?: number | null
  /** guest's own food choice (for exact catering counts) */
  food?: FoodPref | null
}

export interface Registration {
  id: string
  event_id: string
  user_id: string
  code: string
  status: RegistrationStatus
  full_name: string
  email: string | null
  phone: string
  branch: string | null
  grad_year: number | null
  city: string | null
  tshirt_size: TshirtSize | null
  food_pref: FoodPref | null
  needs_accommodation: boolean
  arrival_note: string | null
  guests: Guest[]
  notes: string | null
  terms_accepted_at: string | null
  photo_consent: boolean
  headcount: number
  amount_paise: number
  admin_note: string | null
  checked_in_at: string | null
  checked_in_by: string | null
  created_at: string
  updated_at: string
  // snapshot of the profile at registration
  country: string | null
  designation: string | null
  company: string | null
  past_experience: string | null
  /** days the main ticket covers (null = all) and people per day {"1": 1, "2": 4} */
  days: number[] | null
  day_heads: Record<string, number>
  fund_interest: boolean | null
  fund_paise: number
  org_team_interest: boolean | null
  org_teams: string[]
  needs_local_travel: boolean
  sponsor_interest: boolean | null
  sponsor_level: string | null
  sponsor_org: string | null
  sponsor_note: string | null
  perform_interest: boolean | null
  perform_types: string[]
  perform_group: boolean | null
  perform_members: string | null
  perform_description: string | null
  perform_minutes: number | null
  feedback: string | null
  nickname: string | null
  hostel: string | null
  faculty_wish: string | null
  song_requests: string[]
  memory: string | null
  memory_wall_consent: boolean
  arrival_from: string | null
  arrival_date: string | null
  arrival_mode: string | null
  emergency_name: string | null
  emergency_phone: string | null
  medical_notes: string | null
  custom_answers: Record<string, CustomAnswer>
}

export interface RegistrationItem {
  registration_id: string
  ticket_type_id: string
  label: string
  unit_price_paise: number
  quantity: number
}

export interface Payment {
  id: string
  registration_id: string
  amount_paise: number
  method: 'upi' | 'cash' | 'bank_transfer' | 'waiver'
  utr: string | null
  payer_name: string | null
  proof_path: string | null
  status: PaymentStatus
  review_note: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

export interface EventPhoto {
  id: string
  event_id: string
  uploaded_by: string
  storage_path: string
  thumb_path: string
  width: number | null
  height: number | null
  caption: string | null
  kind: 'event' | 'throwback'
  drive_file_id: string | null
  is_hidden: boolean
  created_at: string
}
