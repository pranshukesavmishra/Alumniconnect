// Data layer for Give Back. Every read and write goes through a SECURITY DEFINER function (no table is open to the API).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { compressImage } from '../../lib/image'
import { publicUrl, supabase } from '../../lib/supabase'

export interface CampaignSummary {
  id: string
  slug: string
  type: string
  title: string
  summary: string | null
  cover_path: string | null
  goal_paise: number
  raised_paise: number
  donor_count: number
  starts_at: string | null
  ends_at: string | null
  status: 'draft' | 'live' | 'paused' | 'completed'
  department: string | null
  batch_from: number | null
  batch_to: number | null
  is_featured: boolean
  submitted_count?: number
}
export interface GivingItem { id: string; name: string; description: string | null; price_paise: number; funded_paise: number; pending_paise: number }
export interface Milestone { percent: number; title: string; unlocks: string | null; amount_paise: number; reached: boolean }
export interface CampaignUpdate { id: string; title: string | null; body: string; image_path: string | null; created_at: string }
export interface CampaignDetail extends CampaignSummary {
  story: string | null
  suggested_paise: number[]
  upi_id: string | null
  payee_name: string
  accepting: boolean
  foreign_notice: string | null
  spent_paise: number
  items: GivingItem[]
  milestones: Milestone[]
  updates: CampaignUpdate[]
  my_pledge: { remind_on: string; monthly: boolean; amount_paise: number | null; active: boolean } | null
  my_total_paise: number
}
export interface ReunionFund { raised_paise: number; pending_paise: number; contributors: number }
export interface Hub { campaigns: CampaignSummary[]; reunion: ReunionFund; departments: string[] }
export interface Donor { id: string; anonymous: boolean; amount_paise: number; at: string | null; name: string | null; batch: number | null; message: string | null; dedication: string | null }
export interface Leaderboard { batches: { batch: number; raised_paise: number; donors: number }[]; anonymous_paise: number }
export interface MyDonation {
  id: string; kind: string; amount_paise: number; status: 'submitted' | 'verified' | 'rejected' | 'refunded'; created_at: string; verified_at: string | null
  receipt_no: string | null; is_anonymous: boolean; review_note: string | null; dedication: string | null; campaign_title: string | null; campaign_slug: string | null; item_name: string | null
}
export interface MyGiving { donations: MyDonation[]; pledges: { campaign_title: string; campaign_slug: string; remind_on: string; monthly: boolean; amount_paise: number | null }[]; notify_new: boolean }
export interface Receipt {
  receipt_no: string; status: string; amount_paise: number; method: string; utr: string | null; reference: string | null; date: string; kind: string; dedication: string | null
  donor_name: string; donor_batch: number | null; campaign_title: string | null; item_name: string | null; event_title: string | null
  assoc_name: string | null; assoc_details: string | null; payee_name: string | null; footer: string | null; tax_text: string | null; foreign_notice: string | null
}
export interface Expense { id: string; description: string; amount_paise: number; spent_on: string; receipt_path: string | null; campaign_title: string | null; campaign_slug?: string | null; campaign_id?: string | null; event_id?: string | null }
export interface Transparency {
  campaigns: { title: string; slug: string; type: string; raised_paise: number; spent_paise: number }[]
  sponsorship: { cash_paise: number; in_kind_paise: number; events: { title: string; cash_paise: number; spent_paise: number }[] }
  reunion: ReunionFund
  total_raised_paise: number
  total_spent_paise: number
  expenses: Expense[]
}
export interface WallTier { tier: string; rank: number; sponsors: { id: string; name: string; logo_path: string | null; website: string | null; blurb: string | null; in_kind: boolean }[] }
export interface PublicPackage { id: string; name: string; price_paise: number; is_in_kind: boolean; benefits: string[]; slots: number | null; available: number | null }

export const coverUrl = (path: string | null | undefined) => publicUrl('giving', path)

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args as never)
  if (error) throw error
  return data as T
}

function useRpcQuery<T>(key: unknown[], fn: string, args?: Record<string, unknown>, opts: { enabled?: boolean; staleTime?: number; refetchInterval?: number } = {}) {
  return useQuery({ queryKey: ['giving', ...key], enabled: opts.enabled ?? true, staleTime: opts.staleTime ?? 15_000, refetchInterval: opts.refetchInterval, queryFn: () => rpc<T>(fn, args) })
}

/** A write: calls the function, then refreshes everything under ['giving'] so every screen shows the new totals. */
export function useAct<A extends unknown[], R = unknown>(call: (...a: A) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (a: A) => call(...a),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['giving'] }),
  })
}

// ------------------------------------------------------------------ member
export const useHub = () => useRpcQuery<Hub>(['hub'], 'giving_hub')
export const useFeatured = (enabled = true) => useRpcQuery<CampaignSummary | null>(['featured'], 'giving_featured', undefined, { enabled, staleTime: 60_000 })
export const useCampaign = (slug: string | undefined) => useRpcQuery<CampaignDetail>(['campaign', slug], 'giving_campaign', { p_slug: slug }, { enabled: !!slug })
export const useDonors = (id: string | undefined, limit: number) => useRpcQuery<Donor[]>(['donors', id, limit], 'giving_donors', { p_campaign: id, p_limit: limit, p_offset: 0 }, { enabled: !!id })
export const useLeaderboard = (id: string | null) => useRpcQuery<Leaderboard>(['board', id], 'giving_leaderboard', { p_campaign: id })
export const useMyGiving = () => useRpcQuery<MyGiving>(['mine'], 'giving_my_donations')
export const useTransparency = () => useRpcQuery<Transparency>(['transparency'], 'giving_transparency')
export const useReceipt = (id: string | undefined) => useRpcQuery<Receipt>(['receipt', id], 'giving_receipt', { p_id: id }, { enabled: !!id })
export const useSponsorWall = (scope: { event?: string; campaign?: string }) =>
  useRpcQuery<WallTier[]>(['wall', scope.event ?? null, scope.campaign ?? null], 'giving_sponsor_wall', { p_event: scope.event ?? null, p_campaign: scope.campaign ?? null },
    { enabled: !!(scope.event || scope.campaign), staleTime: 60_000 })
export const usePublicPackages = (scope: { event?: string; campaign?: string }, enabled: boolean) =>
  useRpcQuery<PublicPackage[]>(['pkgs', scope.event ?? null, scope.campaign ?? null], 'giving_sponsor_packages', { p_event: scope.event ?? null, p_campaign: scope.campaign ?? null }, { enabled })

export const submitGift = (a: { campaign: string; item: string | null; amount: number; utr: string; payer: string; anonymous: boolean; message: string; dedication: string }) =>
  rpc('giving_submit', { p_campaign: a.campaign, p_item: a.item, p_amount: a.amount, p_utr: a.utr, p_payer: a.payer, p_anonymous: a.anonymous, p_message: a.message, p_dedication: a.dedication })
export const setPledge = (campaign: string, remindOn: string, monthly: boolean, amount: number | null) => rpc('giving_pledge_set', { p_campaign: campaign, p_remind_on: remindOn, p_monthly: monthly, p_amount: amount })
export const cancelPledge = (campaign: string) => rpc('giving_pledge_cancel', { p_campaign: campaign })
export const setNotifyNew = (on: boolean) => rpc('giving_set_prefs', { p_notify_new: on })
export const sponsorInterest = (a: { event?: string; campaign?: string; pkg?: string | null; org: string; note: string }) =>
  rpc('giving_sponsor_interest', { p_event: a.event ?? null, p_campaign: a.campaign ?? null, p_package: a.pkg ?? null, p_org: a.org, p_note: a.note })

// ------------------------------------------------------------------ images (covers, update pictures, receipts, logos): public 'giving' bucket
export async function uploadGivingImage(file: File): Promise<string> {
  const img = await compressImage(file, 1600, 0.82)
  const path = `giving/${crypto.randomUUID()}.${img.ext}`
  const { error } = await supabase.storage.from('giving').upload(path, img.blob, { contentType: img.type, upsert: false })
  if (error) throw error
  return path
}

// ------------------------------------------------------------------ admin
export interface AdminCampaign extends CampaignSummary {
  story: string | null
  suggested_paise: number[]
  upi_id: string | null
  payee_name: string | null
  published_at: string | null
  items: { id: string; name: string; description: string | null; price_paise: number; funded_paise: number }[]
  milestones: { id: string; percent: number; title: string; unlocks: string | null; reached_at: string | null }[]
  updates: CampaignUpdate[]
}
export interface Settings {
  default_upi_id: string | null; payee_name: string | null; assoc_name: string | null; assoc_details: string | null
  receipt_footer: string | null; tax_text: string | null; foreign_notice: string | null
}
export interface QueueRow {
  id: string; kind: string; status: 'submitted' | 'verified' | 'rejected' | 'refunded'; amount_paise: number; method: string; utr: string | null; reference: string | null
  created_at: string; verified_at: string | null; receipt_no: string | null; is_anonymous: boolean; message: string | null; dedication: string | null
  donor_name: string | null; payer_name: string | null; donor_batch: number | null; user_id: string | null; campaign_id: string | null; campaign_title: string | null
  item_name: string | null; sponsor_id: string | null; offline_reason: string | null; review_note: string | null; refund_reason: string | null; utr_conflict: boolean
}
export interface AdminPackage { id: string; event_id: string | null; campaign_id: string | null; name: string; rank: number; price_paise: number; slots: number | null; benefits: string[]; is_in_kind: boolean; is_active: boolean; sold: number; available: number | null }
export interface AdminSponsor {
  id: string; event_id: string | null; campaign_id: string | null; package_id: string | null; name: string; logo_path: string | null; website: string | null; blurb: string | null
  contact_name: string | null; contact_email: string | null; contact_phone: string | null; alumni_id: string | null; alumni_name: string | null; owner_id: string | null; owner_name: string | null
  stage: string; committed_paise: number | null; is_in_kind: boolean; in_kind_description: string | null; in_kind_value_paise: number | null; follow_up_on: string | null
  show_on_wall: boolean; created_at: string; package_name: string | null; for_title: string | null; paid_paise: number; pending_paise: number
}
export interface SponsorDetail extends AdminSponsor {
  notes: { id: string; body: string; is_system: boolean; created_at: string; author: string | null }[]
  deliverables: { id: string; title: string; due_on: string | null; done: boolean }[]
  payments: { id: string; amount_paise: number; status: string; method: string; utr: string | null; receipt_no: string | null; created_at: string }[]
}
export interface SuggestedLead { registration_id: string; member_id: string; name: string; org: string | null; level: string | null; note: string | null; phone: string | null; email: string | null; batch: number | null }
export interface SponsorDocument {
  sponsor: string; contact_name: string | null; stage: string; is_in_kind: boolean; in_kind_description: string | null; in_kind_value_paise: number | null; agreed_paise: number | null
  paid_paise: number; package: string | null; benefits: string[]; for_title: string | null; payments: { receipt_no: string; amount_paise: number; method: string; utr: string | null; date: string }[]
  deliverables: { title: string; due_on: string | null; done: boolean }[]; assoc_name: string | null; assoc_details: string | null; payee_name: string | null; upi_id: string | null
  footer: string | null; tax_text: string | null; foreign_notice: string | null
}

export const useAdminCampaigns = (enabled = true) => useRpcQuery<CampaignSummary[]>(['admin', 'campaigns'], 'admin_giving_campaigns', undefined, { enabled })
export const useAdminCampaign = (id: string | undefined) => useRpcQuery<AdminCampaign>(['admin', 'campaign', id], 'admin_giving_campaign', { p_id: id }, { enabled: !!id && id !== 'new' })
export const useAdminSettings = (enabled = true) => useRpcQuery<Settings>(['admin', 'settings'], 'admin_giving_settings', undefined, { enabled })
export const useAdminExpenses = (enabled = true) => useRpcQuery<Expense[]>(['admin', 'expenses'], 'admin_giving_expenses', { p_campaign: null }, { enabled })
export const useQueue = (status: string, campaign: string | null, q: string, enabled = true) =>
  useRpcQuery<QueueRow[]>(['admin', 'queue', status, campaign, q], 'admin_giving_donations', { p_status: status, p_campaign: campaign, p_q: q || null, p_limit: 300, p_offset: 0 }, { enabled, staleTime: 5_000 })
export const useReport = (kind: string, campaign: string | null, enabled = true) =>
  useRpcQuery<Record<string, unknown>[]>(['admin', 'report', kind, campaign], 'admin_giving_report', { p_kind: kind, p_campaign: campaign }, { enabled })
export const useSponsorReport = (kind: string, enabled = true) =>
  useRpcQuery<Record<string, unknown>[]>(['admin', 'sreport', kind], 'admin_sponsor_report', { p_kind: kind, p_event: null }, { enabled })
export const useAdminPackages = (scope: { event?: string | null; campaign?: string | null }, enabled = true) =>
  useRpcQuery<AdminPackage[]>(['admin', 'pkgs', scope.event ?? null, scope.campaign ?? null], 'admin_sponsor_packages', { p_event: scope.event ?? null, p_campaign: scope.campaign ?? null }, { enabled: enabled && !!(scope.event || scope.campaign) })
export const useAdminSponsors = (scope: { event?: string | null; campaign?: string | null }, enabled = true) =>
  useRpcQuery<AdminSponsor[]>(['admin', 'sponsors', scope.event ?? null, scope.campaign ?? null], 'admin_sponsors', { p_event: scope.event ?? null, p_campaign: scope.campaign ?? null, p_stage: null }, { enabled: enabled && !!(scope.event || scope.campaign) })
export const useAdminSponsor = (id: string | undefined) => useRpcQuery<SponsorDetail>(['admin', 'sponsor', id], 'admin_sponsor', { p_id: id }, { enabled: !!id })
export const useSuggestedLeads = (event: string | null | undefined) => useRpcQuery<SuggestedLead[]>(['admin', 'leads', event], 'admin_sponsor_suggested_leads', { p_event: event }, { enabled: !!event })
export const useSponsorDocument = (id: string | undefined) => useRpcQuery<SponsorDocument>(['admin', 'doc', id], 'admin_sponsor_document', { p_id: id }, { enabled: !!id })
export const useAdminEvents = () =>
  useQuery({
    queryKey: ['giving', 'admin', 'events'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('events').select('id, slug, title').order('starts_at', { ascending: false, nullsFirst: false })
      if (error) throw error
      return data as { id: string; slug: string; title: string }[]
    },
  })

export const admin = {
  saveCampaign: (id: string | null, p: Record<string, unknown>) => rpc<string>('admin_giving_save_campaign', { p_id: id, p }),
  setStatus: (id: string, status: string) => rpc('admin_giving_set_status', { p_id: id, p_status: status }),
  setFeatured: (id: string, on: boolean) => rpc('admin_giving_set_featured', { p_id: id, p_featured: on }),
  deleteCampaign: (id: string) => rpc('admin_giving_delete_campaign', { p_id: id }),
  postUpdate: (campaign: string, title: string, body: string, image: string | null) => rpc('admin_giving_post_update', { p_campaign: campaign, p_title: title, p_body: body, p_image: image }),
  deleteUpdate: (id: string) => rpc('admin_giving_delete_update', { p_id: id }),
  saveExpense: (id: string | null, p: Record<string, unknown>) => rpc('admin_giving_save_expense', { p_id: id, p }),
  deleteExpense: (id: string) => rpc('admin_giving_delete_expense', { p_id: id }),
  saveSettings: (p: Record<string, unknown>) => rpc('admin_giving_save_settings', { p }),
  runReminders: () => rpc<number>('admin_giving_run_reminders'),
  verify: (ids: string[]) => rpc<{ verified: number; skipped: { id: string; reason: string }[] }>('admin_giving_verify', { p_ids: ids }),
  reject: (id: string, note: string) => rpc('admin_giving_reject', { p_id: id, p_note: note }),
  refund: (id: string, reason: string) => rpc('admin_giving_refund', { p_id: id, p_reason: reason }),
  recordOffline: (p: Record<string, unknown>) => rpc('admin_giving_record_offline', { p }),
  logExport: (what: string, count: number) => rpc('admin_giving_log_export', { p_what: what, p_count: count }),
  savePackage: (id: string | null, p: Record<string, unknown>) => rpc<string>('admin_sponsor_save_package', { p_id: id, p }),
  deletePackage: (id: string) => rpc('admin_sponsor_delete_package', { p_id: id }),
  saveSponsor: (id: string | null, p: Record<string, unknown>) => rpc<string>('admin_sponsor_save', { p_id: id, p }),
  setStage: (id: string, stage: string, note: string | null) => rpc('admin_sponsor_set_stage', { p_id: id, p_stage: stage, p_note: note }),
  addNote: (id: string, body: string) => rpc('admin_sponsor_add_note', { p_id: id, p_body: body }),
  deleteSponsor: (id: string) => rpc('admin_sponsor_delete', { p_id: id }),
  saveDeliverable: (sponsor: string, id: string | null, title: string, due: string | null, done: boolean) => rpc('admin_sponsor_save_deliverable', { p_sponsor: sponsor, p_id: id, p_title: title, p_due: due, p_done: done }),
  deleteDeliverable: (id: string) => rpc('admin_sponsor_delete_deliverable', { p_id: id }),
  importLead: (registration: string) => rpc<string>('admin_sponsor_import_lead', { p_registration: registration }),
  recordPayment: (sponsor: string, amount: number, method: string, reference: string, reason: string) => rpc('admin_sponsor_record_payment', { p_sponsor: sponsor, p_amount: amount, p_method: method, p_reference: reference, p_reason: reason }),
}
