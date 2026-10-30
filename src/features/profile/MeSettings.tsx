// The Me page's settings: grouped iOS-style lists with icon tiles, profile strength, and the privacy & showcase switches.
import { Bell, ChevronRight, Globe2, HeartHandshake, Image as ImageIcon, Languages, LogOut, Mail, MapPinned, Palette, ShieldCheck, Sparkles, Users, BookOpen, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { IconTile, type TileTone } from '../../components/ui/IconTile'
import { ProgressRing } from '../../components/ui/Progress'
import { Switch } from '../../components/ui/Form'
import { ThemeToggle } from '../../components/ui/ThemeToggle'
import { useIsOrganiser } from '../../components/layout/AppShell'
import { LanguageSwitch } from '../../i18n/LanguageSwitch'
import { useT, type MsgKey } from '../../i18n'
import { cn } from '../../lib/cn'
import { friendlyError } from '../../lib/errors'
import type { Profile } from '../../lib/types'
import { signOut } from '../auth/AuthProvider'
import { useSetShowcasePrefs, useShowcasePrefs, type ShowcasePrefs } from '../idcard/api'
import { LocationSettings } from '../location/LocationSharing'
import { DownloadMyData } from './DownloadMyData'

/** A titled group of rows on one rounded surface. */
export function SettingsGroup({ title, footer, children, id, className }: { title?: ReactNode; footer?: ReactNode; children: ReactNode; id?: string; className?: string }) {
  return (
    <section id={id} className={cn('scroll-mt-20', className)} aria-labelledby={id ? `${id}-title` : undefined}>
      {title && (
        <h2 id={id ? `${id}-title` : undefined} className="text-eyebrow mb-2 px-1 font-sans text-muted">
          {title}
        </h2>
      )}
      <div className="overflow-hidden rounded-3xl border border-border/80 bg-surface shadow-card [&>*+*]:border-t [&>*+*]:border-border/70">{children}</div>
      {footer && <p className="text-caption mt-2 px-2 text-muted">{footer}</p>}
    </section>
  )
}

export function SettingsLink({ to, icon, tone = 'emerald', label, hint }: { to: string; icon: LucideIcon; tone?: TileTone; label: string; hint?: string }) {
  return (
    <Link to={to} className="flex min-h-16 items-center gap-3.5 px-4 py-3 transition-colors hover:bg-surface-2 active:bg-surface-3">
      <IconTile icon={icon} tone={tone} variant="solid" size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{label}</span>
        {hint && <span className="text-caption block text-muted">{hint}</span>}
      </span>
      <ChevronRight className="size-5 shrink-0 text-subtle" aria-hidden />
    </Link>
  )
}

function SettingsRow({ icon, tone = 'emerald', label, hint, children }: { icon: LucideIcon; tone?: TileTone; label: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3.5 px-4 py-3.5">
      <IconTile icon={icon} tone={tone} variant="solid" size="sm" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{label}</p>
        {hint && <p className="text-caption text-muted">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

/** Profile strength: a ring and the next steps (from profileCompleteness). */
export function ProfileStrengthCard({ percent, steps }: { percent: number; steps: { label: MsgKey; to: string; done: boolean }[] }) {
  const tx = useT()
  const todo = steps.filter((s) => !s.done)
  return (
    <div className="flex h-full flex-col" data-testid="me-completeness">
      <div className="flex items-center gap-4">
        <ProgressRing value={percent} size={76} stroke={7} tone="brand" label={tx('home.complete', { percent })}>
          <span className="text-stat text-[22px]">{percent}%</span>
        </ProgressRing>
        <div className="min-w-0">
          <p className="text-eyebrow text-accent">{tx('pp.strength')}</p>
          <p className="text-title mt-1 text-white">{percent >= 100 ? tx('pp.strengthAllStar') : tx('home.complete', { percent })}</p>
        </div>
      </div>
      {todo.length > 0 && (
        <ul className="mt-4 space-y-1">
          {todo.slice(0, 3).map((s) => (
            <li key={s.label}>
              <Link to={s.to} className="fx-press flex min-h-11 items-center gap-2 rounded-xl px-2 text-[15px] font-semibold text-white hover:bg-white/10">
                <Sparkles className="size-4 shrink-0 text-accent" aria-hidden />
                <span className="min-w-0 flex-1">{tx(s.label)}</span>
                <ChevronRight className="size-4 text-white/60" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const SHOWCASE: { key: keyof ShowcasePrefs; icon: LucideIcon; tone: TileTone; label: MsgKey; hint: MsgKey }[] = [
  { key: 'show_on_world_map', icon: Globe2, tone: 'teal', label: 'pp.sc.map', hint: 'pp.sc.mapHint' },
  { key: 'show_in_yearbook', icon: BookOpen, tone: 'gold', label: 'pp.sc.yearbook', hint: 'pp.sc.yearbookHint' },
  { key: 'card_show_photo', icon: ImageIcon, tone: 'plum', label: 'pp.sc.photo', hint: 'pp.sc.photoHint' },
]

export function ShowcasePrivacy() {
  const tx = useT()
  const { data, isLoading } = useShowcasePrefs()
  const set = useSetShowcasePrefs()
  return (
    <SettingsGroup id="showcase" title={tx('pp.sc.title')} footer={tx('pp.sc.footer')}>
      {SHOWCASE.map((s) => (
        <SettingsRow key={s.key} icon={s.icon} tone={s.tone} label={tx(s.label)} hint={tx(s.hint)}>
          <Switch
            checked={!!data?.[s.key]}
            disabled={isLoading || !data || set.isPending}
            onChange={(v: boolean) =>
              set.mutate({ [s.key]: v }, { onSuccess: () => toast.success(tx('pp.sc.saved')), onError: (e) => toast.error(friendlyError(e)) })
            }
            aria-label={tx(s.label)}
          />
        </SettingsRow>
      ))}
    </SettingsGroup>
  )
}

/** Everything under the profile on the Me page. */
export function MeSettings({ profile }: { profile: Profile }) {
  const tx = useT()
  const navigate = useNavigate()
  const organiser = useIsOrganiser()
  void profile
  return (
    <div className="space-y-7">
      <SettingsGroup title={tx('pp.set.account')}>
        <SettingsLink to="/me/connections" icon={Users} tone="emerald" label={tx('profile.connections')} hint={tx('profile.connectionsHint')} />
        <SettingsLink to="/notifications" icon={Bell} tone="ink" label={tx('notif.title')} hint={tx('profile.notifHint')} />
        <SettingsLink to="/give" icon={HeartHandshake} tone="gold" label={tx('give.giveBack')} hint={tx('pp.giveHint')} />
        <SettingsLink to="/invite" icon={Mail} tone="teal" label={tx('profile.invite')} hint={tx('profile.inviteHint')} />
        {organiser && <SettingsLink to="/admin" icon={ShieldCheck} tone="maroon" label={tx('nav.organise')} hint={tx('profile.organiseHint')} />}
      </SettingsGroup>

      <ShowcasePrivacy />

      <SettingsGroup id="language" title={tx('pp.set.display')}>
        <SettingsRow icon={Languages} tone="teal" label={<span id="lang-title">भाषा / Language</span>}>
          <LanguageSwitch compact />
        </SettingsRow>
        <div id="appearance" className="scroll-mt-20 px-4 py-3.5">
          <div className="mb-3 flex items-center gap-3.5">
            <IconTile icon={Palette} tone="plum" variant="solid" size="sm" />
            <div>
              <p className="font-semibold" id="theme-title">{tx('ds.theme.title')}</p>
              <p className="text-caption text-muted">{tx('ds.theme.hint')}</p>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </SettingsGroup>

      <section aria-label={tx('loc.title')} className="space-y-2">
        <h2 className="text-eyebrow px-1 font-sans text-muted">
          <MapPinned className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
          {tx('pp.set.location')}
        </h2>
        <LocationSettings />
      </section>

      <section id="my-data" className="scroll-mt-20 space-y-2">
        <h2 className="text-eyebrow px-1 font-sans text-muted">{tx('pp.set.data')}</h2>
        <DownloadMyData />
      </section>

      <SettingsGroup>
        <button
          type="button"
          className="flex min-h-14 w-full items-center gap-3.5 px-4 py-3 text-left font-semibold text-danger transition-colors hover:bg-danger-soft"
          onClick={async () => {
            await signOut()
            navigate('/', { replace: true })
          }}
        >
          <IconTile icon={LogOut} tone="maroon" variant="soft" size="sm" />
          {tx('profile.signOut')}
        </button>
      </SettingsGroup>
    </div>
  )
}
