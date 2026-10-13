import { Bell, BriefcaseBusiness, CalendarHeart, Camera, Check, Crown, GraduationCap, HandHeart, Heart, Mail, MapPin, MessagesSquare, Plus, Search, Send, Settings, ShieldCheck, Sparkles, Star, Users } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Navigate } from 'react-router'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { Avatar, AvatarStack } from '../../components/ui/Avatar'
import { Button, ButtonLink, IconButton, type ButtonVariant } from '../../components/ui/Button'
import { Card, Divider, GlassPanel, SectionHeader } from '../../components/ui/Card'
import { Confetti } from '../../components/ui/Confetti'
import { Countdown } from '../../components/ui/Countdown'
import { Dialog } from '../../components/ui/Dialog'
import { Badge, Chip, EmptyState, KeyValue, Notice, SectionTitle } from '../../components/ui/Display'
import { Checkbox, ChoiceGroup, Field, Input, Select, Stepper, Switch, Textarea } from '../../components/ui/Form'
import { IconTile, type TileTone } from '../../components/ui/IconTile'
import { CampusArchArt, CelebrationArt, EmptyInboxArt, NoEventsArt, NoPhotosArt, NoResultsArt, OfflineArt } from '../../components/ui/Illustrations'
import { NumberTicker, Reveal, Stagger } from '../../components/ui/Motion'
import { ProgressBar, ProgressRing } from '../../components/ui/Progress'
import { Sheet, SheetAction } from '../../components/ui/Sheet'
import { SkeletonCard, SkeletonList, SkeletonProfile } from '../../components/ui/Skeleton'
import { StatTile } from '../../components/ui/Stat'
import { AuroraBackground, GradientText, ShimmerText } from '../../components/ui/Surfaces'
import { Tabs } from '../../components/ui/Tabs'
import { ThemeToggle } from '../../components/ui/ThemeToggle'
import { Tooltip } from '../../components/ui/Tooltip'
import { cn } from '../../lib/cn'
import { useMyProfile } from '../auth/AuthProvider'

// Internal living style guide (dev builds, or admins in production). English only on purpose.

const SCALES = ['emerald', 'gold', 'maroon', 'sand'] as const
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
const SEMANTIC = [
  ['bg', 'Page'], ['surface', 'Card'], ['surface-2', 'Sunken'], ['surface-3', 'Track'], ['elevated', 'Sheet/dialog'],
  ['text', 'Text'], ['muted', 'Secondary text'], ['subtle', 'Placeholder'], ['border', 'Hairline'], ['border-strong', 'Control edge'],
  ['primary', 'Primary'], ['primary-soft', 'Primary tint'], ['accent', 'Gold'], ['accent-soft', 'Gold tint'], ['gold-ink', 'Gold text'],
  ['official', 'Crest maroon'], ['official-soft', 'Maroon tint'], ['success', 'Success'], ['warning', 'Warning'], ['danger', 'Danger'], ['info', 'Info'],
  ['hero', 'Hero'], ['hero-text', 'On hero'],
] as const

function Block({ id, title, eyebrow, children }: { id: string; title: string; eyebrow: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-4 border-t border-border/70 pt-8">
      <SectionHeader eyebrow={eyebrow} title={title} />
      {children}
    </section>
  )
}

function Row({ label, children, className }: { label?: string; children: ReactNode; className?: string }) {
  return (
    <div className="space-y-2">
      {label && <p className="text-caption font-semibold text-muted">{label}</p>}
      <div className={cn('flex flex-wrap items-center gap-3', className)}>{children}</div>
    </div>
  )
}

function Tokens() {
  return (
    <div className="space-y-5">
      {SCALES.map((s) => (
        <div key={s}>
          <p className="text-caption mb-1.5 font-semibold capitalize text-muted">{s}</p>
          <div className="grid grid-cols-11 overflow-hidden rounded-2xl border border-border/60">
            {STEPS.map((n) => (
              <div key={n} className="h-12" style={{ background: `var(--${s}-${n})` }} title={`${s}-${n}`}>
                <span className={cn('block pt-7 text-center text-[9px] font-semibold', n >= 500 ? 'text-white/85' : 'text-black/55')}>{n}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {SEMANTIC.map(([k, label]) => (
          <div key={k} className="flex items-center gap-2.5 rounded-2xl border border-border/60 bg-surface p-2">
            <span className="size-9 shrink-0 rounded-xl border border-black/5" style={{ background: `var(--${k})` }} />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold">{label}</span>
              <span className="block truncate font-mono text-[11px] text-muted">--{k}</span>
            </span>
          </div>
        ))}
      </div>
      <Row label="Elevation 1–5">
        {[1, 2, 3, 4, 5].map((n) => (
          <div key={n} className="grid size-16 place-items-center rounded-2xl bg-surface text-sm font-semibold" style={{ boxShadow: `var(--shadow-${n})` }}>
            e{n}
          </div>
        ))}
      </Row>
      <Row label="Radii: 8 · 12 · 14 (controls) · 16 · 20 · 24 (cards) · 32 · pill">
        {['8px', '12px', '14px', '16px', '20px', '24px', '32px', '999px'].map((r) => (
          <div key={r} className="size-12 border-2 border-primary/60 bg-primary-soft" style={{ borderRadius: r }} />
        ))}
      </Row>
    </div>
  )
}

function Type() {
  return (
    <div className="space-y-3">
      <p className="text-display-xl">Since 1947</p>
      <p className="text-display">Every JECian, one tap away</p>
      <p className="text-h1">Grand Reunion 2026</p>
      <p className="text-h2">Your batch is here</p>
      <p className="text-h3">Section heading (sans)</p>
      <p className="text-title">Card title — Aarav Mehta</p>
      <p className="text-body-lg text-muted">Body large. Reconnect with batch-mates, mentors and the college that shaped you.</p>
      <p className="text-body text-muted">Body. The default for paragraphs in cards and lists.</p>
      <p className="text-caption text-muted">Caption · 2 hours ago · Pune</p>
      <p className="text-eyebrow text-gold-ink">Eyebrow · Jabalpur Engineering College</p>
      <p className="text-stat text-5xl">
        <NumberTicker value={6401} />
      </p>
      <div lang="hi" className="space-y-1 rounded-2xl border border-dashed border-border-strong p-3">
        <p className="text-caption text-muted">lang="hi" — headings switch to Devanagari sans</p>
        <h2 className="text-h1">ग्रैंड रीयूनियन 2026</h2>
        <p className="text-display">हर JECian, बस एक टैप दूर</p>
      </div>
    </div>
  )
}

function Buttons() {
  const variants: ButtonVariant[] = ['primary', 'secondary', 'outline', 'ghost', 'gold', 'success', 'danger', 'danger-ghost']
  return (
    <div className="space-y-4">
      <Row label="Variants">
        {variants.map((v) => (
          <Button key={v} variant={v}>
            {v}
          </Button>
        ))}
      </Row>
      <Row label="Sizes, icons, loading, disabled">
        <Button size="sm" icon={<Plus className="size-4" />}>Small</Button>
        <Button size="md" icon={<Send className="size-4" />} haptic>Send</Button>
        <Button size="lg">Register now</Button>
        <Button loading>Saving</Button>
        <Button disabled variant="secondary">Disabled</Button>
        <IconButton label="Search"><Search className="size-5" /></IconButton>
        <IconButton label="Notifications" variant="secondary"><Bell className="size-5" /></IconButton>
        <IconButton label="Like" variant="primary"><Heart className="size-5" /></IconButton>
      </Row>
      <AuroraBackground className="rounded-3xl p-5">
        <Row label="">
          <ButtonLink to="/styleguide" variant="glass">Glass on aurora</ButtonLink>
          <Button variant="gold" icon={<Crown className="size-4" />}>Become a patron</Button>
        </Row>
      </AuroraBackground>
    </div>
  )
}

function Cards() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Card className="p-5">
        <p className="text-title">Default</p>
        <p className="text-body text-muted">Hairline + soft elevation. Most content.</p>
      </Card>
      <Card variant="elevated" className="p-5">
        <p className="text-title">Elevated</p>
        <p className="text-body text-muted">Floating things: featured, pinned.</p>
      </Card>
      <Card variant="interactive" className="p-5" tabIndex={0}>
        <p className="text-title">Interactive</p>
        <p className="text-body text-muted">Lifts on hover, presses on tap.</p>
      </Card>
      <Card variant="gradient-border" className="p-5">
        <p className="text-title">Gradient border</p>
        <p className="text-body text-muted">Special: founding members, sponsors.</p>
      </Card>
      <AuroraBackground className="rounded-3xl p-4 sm:col-span-2">
        <div className="grid grid-cols-2 gap-3">
          <GlassPanel tone="dark" className="p-4">
            <p className="text-caption text-white/75">Glass (dark)</p>
            <p className="text-stat mt-1 text-3xl">75 days</p>
          </GlassPanel>
          <Card variant="glass" className="p-4">
            <p className="text-caption text-muted">Glass (theme)</p>
            <p className="text-stat mt-1 text-3xl">312</p>
          </Card>
        </div>
      </AuroraBackground>
      <Card className="divide-y divide-border px-4 sm:col-span-2">
        <dl>
          <KeyValue label="Batch">2008</KeyValue>
          <KeyValue label="Branch">Computer Science &amp; Engineering</KeyValue>
        </dl>
      </Card>
    </div>
  )
}

function BadgesAvatars() {
  const [sel, setSel] = useState('All')
  const tones: TileTone[] = ['emerald', 'gold', 'maroon', 'teal', 'ink', 'plum', 'neutral']
  const icons = [Users, CalendarHeart, ShieldCheck, MapPin, BriefcaseBusiness, GraduationCap, Settings]
  return (
    <div className="space-y-5">
      <Row label="Badges">
        <Badge>Neutral</Badge>
        <Badge tone="primary">Verified</Badge>
        <Badge tone="success">Confirmed</Badge>
        <Badge tone="warning">Pending</Badge>
        <Badge tone="danger">Rejected</Badge>
        <Badge tone="info">New</Badge>
        <Badge tone="official" icon={<ShieldCheck />}>Official</Badge>
        <Badge tone="gold" icon={<Star />}>Patron</Badge>
        <Badge tone="founding" icon={<Crown />}>Founding member</Badge>
      </Row>
      <Row label="Chips (aria-pressed)" className="flex-nowrap overflow-x-auto pb-1">
        {['All', 'My batch', 'Mentors', 'Nearby'].map((c) => (
          <Chip key={c} selected={sel === c} onClick={() => setSel(c)}>
            {c}
          </Chip>
        ))}
      </Row>
      <Row label="IconTile — soft / solid / glass, sm–xl">
        {tones.map((t, i) => (
          <IconTile key={t} icon={icons[i]!} tone={t} />
        ))}
      </Row>
      <Row>
        {tones.map((t, i) => (
          <IconTile key={t} icon={icons[i]!} tone={t} variant="solid" size="lg" />
        ))}
      </Row>
      <Row label="Avatars — gradient initials (deterministic), rings, presence">
        <Avatar name="Aarav Mehta" size={56} />
        <Avatar name="Priya Sharma" size={56} ring="story" />
        <Avatar name="Rohit Verma" size={56} ring="seen" />
        <Avatar name="Neha Gupta" size={56} ring="verified" presence="online" />
        <Avatar name="JEC Official" size={56} ring="official" />
        <Avatar name="Kabir Singh" size={40} presence="away" />
        <Avatar name="Meera Iyer" size={32} />
        <AvatarStack label="12 batch-mates going" people={['Aarav Mehta', 'Priya Sharma', 'Rohit Verma', 'Neha Gupta', 'Kabir Singh', 'Meera Iyer'].map((name) => ({ name }))} />
      </Row>
    </div>
  )
}

function Data() {
  const [n, setN] = useState(1240)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Members" value={n} icon={<Users />} hint="+38 this week" />
        <StatTile label="Raised" value={1250000} prefix="₹" icon={<HandHeart />} hint="of ₹20,00,000" />
      </div>
      <Button size="sm" variant="secondary" onClick={() => setN((v) => v + 137)}>Replay count-up (+137)</Button>
      <AuroraBackground className="rounded-3xl p-4">
        <p className="text-eyebrow mb-3 text-accent">Grand Reunion 2026</p>
        <Countdown to="2026-12-26T10:00:00+05:30" variant="glass" />
        <div className="mt-3 grid grid-cols-3 gap-2">
          <StatTile variant="glass" label="Registered" value={312} />
          <StatTile variant="glass" label="Batches" value={10} />
          <StatTile variant="glass" label="Cities" value={41} />
        </div>
      </AuroraBackground>
      <Countdown to="2026-12-26T10:00:00+05:30" seconds={false} />
      <div className="flex items-center gap-5">
        <ProgressRing value={72} size={84} label="Profile 72% complete">
          <span className="text-stat text-xl">72%</span>
        </ProgressRing>
        <ProgressRing value={45} size={64} tone="gold" label="Goal" />
        <div className="flex-1 space-y-3">
          <ProgressBar value={72} label="Profile" />
          <ProgressBar value={62} tone="gold" size="lg" label="Fund" />
          <ProgressBar value={35} tone="brand" size="sm" label="Brand" />
        </div>
      </div>
    </div>
  )
}

function Controls() {
  const [tab, setTab] = useState<'feed' | 'people' | 'events'>('feed')
  const [pill, setPill] = useState('all')
  const [under, setUnder] = useState('about')
  const [on, setOn] = useState(true)
  const [on2, setOn2] = useState(false)
  const [ch, setCh] = useState(false)
  const [choice, setChoice] = useState<'veg' | 'non'>('veg')
  const [num, setNum] = useState(1)
  return (
    <div className="space-y-5">
      <Tabs label="Segmented" value={tab} onChange={setTab} options={[{ value: 'feed', label: 'Feed' }, { value: 'people', label: 'People', count: 4 }, { value: 'events', label: 'Events' }]} />
      <Tabs label="Pills" variant="pills" value={pill} onChange={setPill} options={['all', 'batch', 'mentors', 'nearby', 'jobs', 'circles'].map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) }))} />
      <Tabs label="Underline" variant="underline" value={under} onChange={setUnder} options={[{ value: 'about', label: 'About' }, { value: 'work', label: 'Work' }, { value: 'photos', label: 'Photos' }]} />
      <ThemeToggle />
      <Card className="space-y-4 p-4">
        <Field label="Full name" hint="As your batch-mates know you">
          {(p) => <Input {...p} placeholder="e.g. Aarav Mehta" />}
        </Field>
        <Field label="Email" success="Looks good">
          {(p) => <Input {...p} leading={<Mail />} defaultValue="aarav@example.com" />}
        </Field>
        <Field label="Search" optional>
          {(p) => <Input {...p} leading={<Search />} placeholder="Name, company, city" />}
        </Field>
        <Field label="Amount" error="Enter at least ₹100">
          {(p) => <Input {...p} leading={<span className="font-semibold">₹</span>} defaultValue="50" inputMode="numeric" />}
        </Field>
        <Field label="Branch">
          {(p) => (
            <Select {...p}>
              <option>Computer Science &amp; Engineering</option>
              <option>Civil Engineering</option>
            </Select>
          )}
        </Field>
        <Field label="About you">{(p) => <Textarea {...p} placeholder="A line or two" />}</Field>
        <ChoiceGroup label="Meal" columns={2} value={choice} onChange={setChoice} options={[{ value: 'veg', label: 'Vegetarian' }, { value: 'non', label: 'Non-veg', hint: 'Chicken' }]} />
        <Checkbox checked={ch} onChange={setCh}>I agree to share my city with batch-mates</Checkbox>
        <Switch checked={on} onChange={setOn} label="Show me on the map" hint="Only your city, never your address" />
        <Switch checked={on2} onChange={setOn2} label="Email digests" />
        <Stepper label="Guests" value={num} max={5} onChange={setNum} />
      </Card>
    </div>
  )
}

function Feedback() {
  const [sheet, setSheet] = useState(false)
  const [dialog, setDialog] = useState(false)
  return (
    <div className="space-y-4">
      <Notice tone="info" title="Registrations close on 15 December">Pay before then to keep your place.</Notice>
      <Notice tone="success" title="You are registered" />
      <Notice tone="warning" title="Photo pending review">An admin will check it soon.</Notice>
      <Notice tone="danger" title="Could not save">Check your connection and try again.</Notice>
      <Row label="Toasts (sonner)">
        <Button size="sm" variant="secondary" onClick={() => toast.success('Saved to your profile')}>Success</Button>
        <Button size="sm" variant="secondary" onClick={() => toast.error('Could not send', { description: 'You are offline' })}>Error</Button>
        <Button size="sm" variant="secondary" onClick={() => toast('Link copied', { action: { label: 'Undo', onClick: () => undefined } })}>Neutral</Button>
      </Row>
      <Row label="Overlays">
        <Button size="sm" variant="secondary" onClick={() => setSheet(true)}>Open sheet</Button>
        <Button size="sm" variant="secondary" onClick={() => setDialog(true)}>Open dialog</Button>
        <Tooltip content="Only visible on desktop hover / focus">
          <Button size="sm" variant="ghost">Hover me</Button>
        </Tooltip>
      </Row>
      <Sheet open={sheet} onClose={() => setSheet(false)} label="Example sheet">
        <h2 className="text-h2 px-5 pb-2 pt-2">Share post</h2>
        <SheetAction icon={<MessagesSquare />} onClick={() => setSheet(false)}>Send in chat</SheetAction>
        <SheetAction icon={<Camera />} onClick={() => setSheet(false)}>Add to story</SheetAction>
        <SheetAction danger icon={<ShieldCheck />} onClick={() => setSheet(false)}>Report</SheetAction>
      </Sheet>
      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        icon={<IconTile icon={Sparkles} tone="gold" variant="solid" size="lg" />}
        title="Leave this circle?"
        description="You can join again any time."
        actions={
          <>
            <Button variant="secondary" onClick={() => setDialog(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => setDialog(false)}>Leave</Button>
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <SkeletonCard />
        <Card className="px-4"><SkeletonList rows={3} /></Card>
      </div>
      <SkeletonProfile />
      <Card>
        <EmptyState icon={<Users />} title="No connections yet" action={<Button size="sm">Find batch-mates</Button>}>
          People you connect with appear here.
        </EmptyState>
      </Card>
    </div>
  )
}

function Art() {
  const items: [string, ReactNode][] = [
    ['EmptyInboxArt', <EmptyInboxArt />],
    ['NoResultsArt', <NoResultsArt />],
    ['NoEventsArt', <NoEventsArt />],
    ['NoPhotosArt', <NoPhotosArt />],
    ['OfflineArt', <OfflineArt />],
    ['CelebrationArt', <CelebrationArt />],
  ]
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map(([name, el]) => (
          <Card key={name} className="p-3 text-center">
            <div className="mx-auto w-full max-w-[160px] [&_svg]:h-auto [&_svg]:w-full">{el}</div>
            <p className="mt-1 font-mono text-[11px] text-muted">{name}</p>
          </Card>
        ))}
      </div>
      <Card>
        <EmptyState illustration={<NoResultsArt />} title="No one matches that search" action={<Button variant="secondary" size="sm">Clear filters</Button>}>
          Try a batch year, a city or a company.
        </EmptyState>
      </Card>
      <AuroraBackground className="rounded-3xl px-5 pb-16 pt-6" art={<CampusArchArt />}>
        <p className="text-eyebrow text-accent">Jabalpur Engineering College · 1947</p>
        <p className="text-display mt-2">
          Onwards <GradientText tone="gold">on wings</GradientText>
        </p>
        <p className="mt-2 text-hero-text">
          <ShimmerText>Registrations are open</ShimmerText>
        </p>
      </AuroraBackground>
    </div>
  )
}

function MotionDemo() {
  const [burst, setBurst] = useState(0)
  const [key, setKey] = useState(0)
  return (
    <div className="space-y-4">
      <Row>
        <Button variant="gold" icon={<Sparkles className="size-4" />} onClick={() => setBurst((b) => b + 1)}>Celebrate</Button>
        <Button variant="secondary" onClick={() => setKey((k) => k + 1)}>Replay stagger</Button>
      </Row>
      <Confetti trigger={burst} />
      <Stagger key={key} className="space-y-2">
        {['Aarav Mehta · 2008 · Pune', 'Priya Sharma · 2010 · Bengaluru', 'Rohit Verma · 2005 · Jabalpur', 'Neha Gupta · 2012 · Delhi'].map((t) => (
          <Card key={t} variant="interactive" className="flex items-center gap-3 p-3">
            <Avatar name={t} size={40} />
            <span className="text-title flex-1">{t.split(' · ')[0]}</span>
            <span className="text-caption text-muted">{t.split(' · ').slice(1).join(' · ')}</span>
          </Card>
        ))}
      </Stagger>
      <Reveal>
        <Card className="p-4 text-center">
          <Check className="mx-auto size-6 text-success" />
          <p className="text-body mt-1">Revealed on scroll</p>
        </Card>
      </Reveal>
    </div>
  )
}

/** The compact showcase rendered twice in "Light | Dark" mode. */
function Compare() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {(['light', 'dark'] as const).map((t) => (
        <div key={t} data-theme={t} className="space-y-3 rounded-3xl border border-border bg-bg p-4">
          <p className="text-eyebrow text-gold-ink">{t}</p>
          <Card className="flex items-center gap-3 p-4">
            <Avatar name="Priya Sharma" ring="story" size={48} />
            <div className="min-w-0 flex-1">
              <p className="text-title truncate">Priya Sharma</p>
              <p className="text-caption truncate text-muted">2010 · Civil · Bengaluru</p>
            </div>
            <Badge tone="official">Official</Badge>
          </Card>
          <div className="flex flex-wrap gap-2">
            <Button size="sm">Connect</Button>
            <Button size="sm" variant="secondary">Message</Button>
            <Button size="sm" variant="gold">Donate</Button>
          </div>
          <ProgressBar value={64} label="Profile" />
          <Notice tone="warning" title="Payment pending" />
          <Row>
            <IconTile icon={Users} />
            <IconTile icon={CalendarHeart} tone="gold" />
            <IconTile icon={ShieldCheck} tone="maroon" />
            <Badge tone="founding">Founding</Badge>
          </Row>
        </div>
      ))}
    </div>
  )
}

const NAV = [
  ['compare', 'Light / Dark'], ['tokens', 'Tokens'], ['type', 'Type'], ['buttons', 'Buttons'], ['cards', 'Cards'], ['badges', 'Badges & avatars'],
  ['data', 'Data'], ['controls', 'Controls'], ['feedback', 'Feedback'], ['art', 'Illustrations'], ['motion', 'Motion'],
] as const

export function StyleguidePage() {
  const { data: profile, isLoading } = useMyProfile()
  if (!import.meta.env.DEV) {
    if (isLoading) return null
    if (!profile?.is_admin) return <Navigate to="/" replace />
  }
  return (
    <div>
      <PageHeader title="Design System 2.0" subtitle="Heritage, modern — tokens, type, components, motion" back="/" />
      <Page wide className="space-y-6 pb-16">
        <AuroraBackground className="rounded-[28px] px-5 pb-20 pt-7 shadow-e4" art={<CampusArchArt />}>
          <p className="text-eyebrow text-accent">JEC Alumni Connect</p>
          <h2 className="text-display mt-2 text-white">The living style guide</h2>
          <p className="text-body-lg mt-2 max-w-xl text-hero-text">Every screen inherits these tokens and components. Read docs/DESIGN.md for the rules.</p>
        </AuroraBackground>
        <nav aria-label="Sections" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
          {NAV.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-border bg-surface px-4 text-sm font-semibold hover:bg-surface-2">
              {label}
            </a>
          ))}
        </nav>
        <Block id="compare" eyebrow="Side by side" title="Light and night emerald"><Compare /></Block>
        <Block id="tokens" eyebrow="Foundations" title="Colour, elevation, radius"><Tokens /></Block>
        <Block id="type" eyebrow="Foundations" title="Typography"><Type /></Block>
        <Block id="buttons" eyebrow="Actions" title="Buttons"><Buttons /></Block>
        <Block id="cards" eyebrow="Containers" title="Cards & surfaces"><Cards /></Block>
        <Block id="badges" eyebrow="Identity" title="Badges, chips, tiles, avatars"><BadgesAvatars /></Block>
        <Block id="data" eyebrow="Numbers" title="Stats, countdown, progress"><Data /></Block>
        <Block id="controls" eyebrow="Input" title="Tabs & forms"><Controls /></Block>
        <Block id="feedback" eyebrow="Status" title="Notices, overlays, loading, empty"><Feedback /></Block>
        <Block id="art" eyebrow="Brand" title="Illustrations & hero"><Art /></Block>
        <Block id="motion" eyebrow="Motion" title="Springs, stagger, reveal, confetti"><MotionDemo /></Block>
        <Divider label="End of guide" />
        <SectionTitle>Legacy section title (still supported)</SectionTitle>
      </Page>
    </div>
  )
}
