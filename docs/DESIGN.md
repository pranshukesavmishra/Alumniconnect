# JEC Alumni Connect — Design System 2.0 ("Heritage, modern")

The single source of truth for how the app looks and moves. Every screen inherits it through the tokens in
`src/index.css` + `src/styles/effects.css` and the components in `src/components/ui/`. The living reference is the
**style guide at `/styleguide`** (always on in dev; admins only in production) — open it next to this file.

Audience: senior engineers and professionals, many 40–70 years old, mostly on Android phones (390px wide), often on
mobile data. They should feel *pride* (a 1947 institution) and *ease* (big type, obvious actions).

---

## 1. Principles

1. **Heritage, modern.** Deep forest emerald + warm JEC gold, a whisper of crest maroon. A serif (Fraunces) for
   headings gives the institution its voice; Inter does the work everywhere else.
2. **Calm surfaces, one hero.** Pages are warm ivory (light) or near-black green (dark) with a faint paper grain.
   Each screen gets at most **one** rich moment (an aurora hero, a celebration) — everything else stays quiet.
3. **Depth through light, not lines.** Hairline borders + soft layered shadows + a 1px inner highlight. No heavy
   outlines, no flat grey boxes.
4. **Generous and touchable.** Every target ≥ 44×44px. Body text ≥ 15px; inputs 16px (no iOS zoom). Cards 24px radius.
5. **Motion explains, never decorates.** Springs for things that move under a finger; fades for things that appear.
   Everything respects `prefers-reduced-motion`.
6. **No emoji in our UI.** Icons are lucide (stroke 1.9–2), in `IconTile`s, or our own SVGs. Enforced by
   `src/styles/noEmoji.test.ts`. Members' own text may contain emoji (user content).
7. **Accessible by construction.** All token pairs meet WCAG AA in both themes (enforced by
   `src/styles/contrast.test.ts`). Never change an existing control's accessible name or role (e2e tests depend on them).

---

## 2. Colour

### Brand scales (theme-independent, usable as `bg-emerald-700`, `text-gold-600`, `border-maroon-700`…)

| step | emerald | gold | maroon | sand (warm neutral) |
|---|---|---|---|---|
| 50 | `#ecf8f2` | `#fdf8ec` | `#fcf1f2` | `#faf9f5` |
| 100 | `#d3efe1` | `#faefd0` | `#f8e1e3` | `#f5f3ed` |
| 200 | `#a7dfc6` | `#f4dc9e` | `#f0c5ca` | `#ebe8de` |
| 300 | `#6fc8a5` | `#ecc56a` | `#e39aa2` | `#dcd7c9` |
| 400 | `#3fae85` | `#e4ad45` | `#d16a77` | `#b3ad9d` |
| 500 | `#1f916a` | `#d4922a` | `#b9434f` | `#8b8676` |
| 600 | `#0f7a57` | `#b5741c` | `#a12c3a` | `#6b685b` |
| 700 | `#0b6b4f` ← primary | `#915719` | `#8b1e2d` ← crest | `#535148` |
| 800 | `#0a5540` | `#74451a` | `#731a27` | `#393832` |
| 900 | `#084434` | `#5f3918` | `#621925` | `#24241f` |
| 950 | `#062a20` ← hero | `#361d09` | `#370910` | `#151612` |

### Semantic tokens (what components use) — Tailwind names in brackets

| token | light | dark ("night emerald") | use |
|---|---|---|---|
| `--bg` (`bg-bg`) | `#f6f4ee` | `#06110d` | page |
| `--surface` (`bg-surface`) | `#ffffff` | `#0c1a15` | cards |
| `--surface-2` | `#f0ede5` | `#12231c` | sunken areas, hover, tracks |
| `--surface-3` | `#e7e3d8` | `#193027` | switch track, pressed |
| `--elevated` | `#ffffff` | `#13261f` | dialogs, popovers |
| `--text` | `#14201a` | `#e9f1ec` | body |
| `--muted` | `#56605a` | `#a2b6ab` | secondary text (AA) |
| `--subtle` | `#6e756f` | `#8a9e93` | placeholders (AA on surface) |
| `--border` / `--border-strong` | `#e4e0d5` / `#cdc7b7` | `#1d3229` / `#2b463b` | hairlines / control edges |
| `--primary` (+`-hover`, `-soft`, `on-primary`) | `#0b6b4f` | `#4fd1a1` | actions, links, selection |
| `--accent` (+`-soft`, `on-accent`) | `#e4ad45` | `#f0b44f` | gold fills (never as text on light) |
| `--gold-ink` | `#845014` | `#f3c46e` | gold **text** (eyebrows, honours) |
| `--official` (+`-soft`, `on-official`) | `#8b1e2d` | `#f0939e` | crest maroon: official markers only |
| `--success/-danger/-warning/-info` (+`-soft`) | AA pairs | AA pairs | status |
| `--hero`, `--hero-2`, `--hero-text` | `#062a20`, `#0b4a37`, `#cfe6db` | darker | dark brand panels |
| `--glass`, `--glass-strong`, `--glass-border`, `--highlight`, `--scrim` | rgba | rgba | glass, inner highlight, overlays |
| `--grad-primary/-gold/-maroon/-brand/-hairline` | gradients | gradients | buttons, foil, borders |

Rules: maroon is **rare** (official badge, a crest accent) — never a button. Gold is for honour and celebration
(Founding member, Donate, countdowns), not for errors. Use `text-gold-ink` for gold text, never `text-accent` on light.

### Theme
`System / Light / Dark` lives in Me → Appearance (`ThemeToggle`). Stored in `localStorage['jec-theme']`
(`src/lib/theme.ts`), applied as `data-theme="light|dark"` on `<html>` before first paint (inline script in `index.html`).
`dark:` utilities follow `data-theme`. Any subtree can be forced with `data-theme="dark"` (the style guide uses this).
`useTheme()` gives `{ pref, resolved, setTheme }`.

---

## 3. Typography

Fonts: **Fraunces Variable** (display serif, self-hosted Latin, opsz + SOFT) and **Inter Variable** (UI).
Hindi (`<html lang="hi">`) swaps the display stack to Inter + **Noto Sans Devanagari** and removes letter-spacing —
never a serif fallback, never spaced Devanagari. `h1`/`h2` are serif by default; an `h1/h2` with `uppercase` or
`font-sans` stays sans.

| utility | size / line | font | use |
|---|---|---|---|
| `text-display-xl` | clamp(40→60px) / 1.02 | serif 600 | landing / hero statements |
| `text-display` | clamp(32→44px) / 1.06 | serif 600 | hero titles |
| `text-h1` | 28 / 1.15 | serif 600 | page titles in content |
| `text-h2` | 22 / 1.22 | serif 600 | section titles (`SectionHeader`) |
| `text-h3` | 18 / 1.33 | sans 650 | card group headings |
| `text-title` | 17 / 1.35 | sans 600 | card / row titles |
| `text-body-lg` | 17 / 1.55 | sans | intros |
| `text-body` | 15 / 1.5 | sans | default paragraph |
| `text-caption` | 13 / 1.4 | sans | meta, timestamps |
| `text-eyebrow` | 12 / 1.2, +0.14em, caps, 700 | sans | over titles; colour `text-gold-ink` (or `text-accent` on hero) |
| `text-stat` | (set size) | serif, tabular, lining | numbers in KPIs / countdowns |

`cn()` (tailwind-merge) knows these, so `cn('text-body', 'text-caption')` resolves correctly.

---

## 4. Space, radius, elevation

- Spacing: Tailwind 4px grid. Page gutter 16px (`Page`), card padding 16–20px, section gap 20–24px (`space-y-5/6`).
- Radii: 8 (`--radius-xs`), 12, **14 controls**, 16, 20 (tiles), **24 cards (`rounded-3xl`)**, 28 sheets/dialogs, 32, pills.
- Elevation: `shadow-e1` … `shadow-e5` (light: green-tinted soft shadows; dark: deep black). `shadow-card` = e2,
  `shadow-pop` = e4. Pair with `inner-highlight` (1px top light) for lit surfaces.
- Containers: `Page` = max-w-3xl (768px), `Page wide` = max-w-6xl.

## 5. Signature surfaces (utilities in `effects.css`)

| utility / component | what |
|---|---|
| `aurora` / `<AuroraBackground>` | deep forest + emerald/teal/gold glows + grain; `animate` adds a slow drift. `art={<CampusArchArt/>}` adds line-art |
| `bg-hero` | existing solid banners automatically render as a (static) aurora |
| `glass` / `<GlassPanel>` | translucent theme surface, blur 18px, inner highlight |
| `glass-dark` / `<GlassPanel tone="dark">` | white-on-aurora glass (for stats on heroes) |
| `hairline-gradient` / `<Card variant="gradient-border">` | 1px emerald→gold→maroon border |
| `text-gradient-brand`, `text-gradient-gold` / `<GradientText>` | display sizes only (≥24px) |
| `shimmer-text` / `<ShimmerText>` | gold light sweep (static with reduced motion) |
| `grain` | the paper-noise texture (already on `body`) |
| `tap`, `lift` | scale .97 on press; hover lift (desktop only) |

## 6. Motion

Tokens: `--dur-1..5` = 120 / 200 / 320 / 500 / 800 ms; `--ease-out` `cubic-bezier(.22,1,.36,1)` (default),
`--ease-in-out`, `--ease-spring` (`.34,1.56,.64,1`, small overshoot). JS springs: `SPRING` (stiff 420, damping 34) and
`SPRING_SOFT` in `Motion.tsx`.

- `motion` is used through `LazyMotion` (`MotionProvider` in `main.tsx`); the feature bundle (domMax, ~28 KB gz) loads on
  idle, so use **`m.*` components**, never `motion.*`. Things render statically until it arrives.
- `MotionConfig reducedMotion="user"`; CSS animations are disabled under reduced motion. For JS animations check
  `useReducedMotion()`.
- Use: spring for shared-layout pills (`Tabs`, `ThemeToggle` use `layoutId`), sheet drags; `Reveal` / `Stagger` (CSS +
  IntersectionObserver, no library) for lists entering; `NumberTicker` for numbers; `Confetti` once per real achievement
  (registration confirmed, payment verified) — never on page load.
- `haptic()` (`src/lib/haptics.ts`) or `<Button haptic>`: 8ms vibration for key confirmations only.
- Keyframes available: `shimmer`, `aurora-drift`, `pulse-ring`, `rise-in`, `pop-in`, `sheet-up`, `flip-in`, `fadeIn`.

## 7. Components (`src/components/ui/`)

Old imports keep working: `Display.tsx` re-exports Card / Avatar / Skeleton.

| component | file | notes |
|---|---|---|
| `Button`, `ButtonLink`, `IconButton`, `buttonClass()` | Button.tsx | variants `primary` (emerald gradient + glow), `secondary`, `outline`, `ghost`, `gold`, `success`, `danger`, `danger-ghost`, `glass` (on aurora); sizes sm 44 / md 48 / lg 56; `loading` (spinner + shimmer), `haptic`, `icon`. `IconButton` requires `label`. |
| `Card`, `cardClass()` | Card.tsx | `variant`: `default`, `elevated`, `glass`, `gradient-border`, `interactive` (lift), `sunken`, `hero` (aurora) |
| `GlassPanel`, `SectionHeader`, `Divider` | Card.tsx | `SectionHeader eyebrow title action description` — serif title |
| `SectionTitle` | Display.tsx | legacy small caps label; fine for dense settings lists |
| `Badge` | Display.tsx | tones `neutral primary success warning danger accent info official gold founding solid`; `icon` prop |
| `Chip` | Display.tsx | toggle pill, `selected` → `aria-pressed` |
| `Notice` | Display.tsx | `info/success/warning/danger`, icon disc, optional `action` |
| `EmptyState` | Display.tsx | `illustration` (preferred) or `icon`; `title`, body, `action`, `compact` |
| `Avatar`, `AvatarStack` | Avatar.tsx | deterministic brand-gradient initials; `ring` = `story/seen/verified/official`; `presence` = `online/away`; `badge` slot |
| `IconTile` | IconTile.tsx | `icon` (lucide component or element), `tone` emerald/gold/maroon/teal/ink/plum/neutral, `variant` soft/solid/glass, `size` sm/md/lg/xl |
| `GroupIcon`, `groupIconFor()` | GroupIcon.tsx | maps a group's stored icon (legacy emoji) or kind → IconTile |
| `ReactionIcon`, `REACTIONS`, `reactionKeyOf()` | Reactions.tsx | Like, Love, Celebrate, Support, Insightful, Funny, Thanks, Wow — gradient badges; stored values stay emoji strings (escaped) |
| `StatTile` / `Kpi` | Stat.tsx | serif count-up number, label, hint, icon; `variant="glass"` on aurora; long numbers step down a size |
| `ProgressBar`, `ProgressRing` | Progress.tsx | gradient fills animate in on view; `tone` primary/gold/brand; need `label` |
| `Countdown` | Countdown.tsx | flip tiles d/h/m(/s), `variant="glass"` for heroes, one `role=timer` label |
| `Tabs` / `SegmentedControl` | Tabs.tsx | `variant` segmented / pills / underline, spring pill, arrow keys, `count` bubbles |
| `Skeleton`, `SkeletonRow`, `SkeletonList`, `SkeletonCard`, `SkeletonProfile` | Skeleton.tsx | shimmer placeholders |
| `Sheet`, `SheetAction`, `useModal` | Sheet.tsx | bottom sheet (phones) / centred (desktop), blur scrim, slide-up, swipe the handle down to close |
| `Dialog` | Dialog.tsx | centred confirm; `title`, `description`, `icon`, `actions` (safe first) |
| `Tooltip` | Tooltip.tsx | desktop hover/focus only; never the only label |
| `AppToaster` | Toast.tsx | sonner styled as glass cards with brand icons; keep calling `toast()` |
| `Field`, `Input` (`leading`/`trailing`), `Textarea`, `Select`, `ChoiceGroup`/`RadioCards`, `Checkbox`, `Switch`, `Stepper` | Form.tsx | 48px controls, 14px radius, soft focus halo, `Field success` state; `Switch` is `role="switch"` |
| `ThemeToggle` | ThemeToggle.tsx | System / Light / Dark |
| `Reveal`, `Stagger`, `NumberTicker`, `useReducedMotion`, `useInViewOnce`, `MotionProvider` | Motion.tsx | |
| `AuroraBackground`, `GradientText`, `ShimmerText` | Surfaces.tsx | |
| `Confetti` | Confetti.tsx | `trigger` (counter); canvas, ~1.6 s, nothing under reduced motion |
| Illustrations | Illustrations.tsx | `EmptyInboxArt`, `NoResultsArt`, `NoEventsArt`, `NoPhotosArt`, `OfflineArt`, `CelebrationArt` (200×160, theme-aware), `CampusArchArt` (400×120 line art, currentColor) |
| `PageHeader`, `Page` | layout/AppShell.tsx | large serif title that scales down and turns to glass on scroll; back button is a soft round chip |

## 8. Recipes — building a premium screen

**Hero = AuroraBackground + eyebrow + serif display + glass stat tiles.**
```tsx
<AuroraBackground className="rounded-b-[32px] px-5 pb-8 pt-[calc(env(safe-area-inset-top)+1.5rem)]" art={<CampusArchArt />}>
  <p className="text-eyebrow text-accent">{tx('brand.college')}</p>
  <h1 className="text-display mt-2">{event.title}</h1>
  <p className="text-body-lg mt-2 text-hero-text">{event.tagline}</p>
  <Countdown to={event.starts_at} variant="glass" className="mt-5" />
  <div className="mt-3 grid grid-cols-3 gap-2">
    <StatTile variant="glass" label="Registered" value={312} />
    …
  </div>
  <ButtonLink to="/meet/register" variant="gold" size="lg" block className="mt-5">Register now</ButtonLink>
</AuroraBackground>
```

**Section = SectionHeader + cards that stagger in.**
```tsx
<section>
  <SectionHeader eyebrow="Your batch" title="JEC 2008" action={<ButtonLink to="/people" variant="ghost" size="sm">See all</ButtonLink>} />
  <Stagger className="space-y-2">{people.map((p) => <Card key={p.id} variant="interactive" className="flex items-center gap-3 p-3">…</Card>)}</Stagger>
</section>
```

**Quick actions = IconTile grid.**
```tsx
<Link className="tap flex flex-col items-center gap-2 rounded-[20px] border border-border/70 bg-surface p-3 shadow-card">
  <IconTile icon={Users} tone="emerald" variant="solid" size="lg" />
  <span className="text-caption font-semibold">People</span>
</Link>
```

**Empty = illustration + one clear action.** `<EmptyState illustration={<NoEventsArt />} title="No meetups yet" action={<Button>Plan one</Button>}>…</EmptyState>`

**Loading = shape-matched skeletons** (`SkeletonList`, `SkeletonCard`) — not spinners — for anything > 300 ms.

**Success moment** = `Notice tone="success"` or a `Dialog` with `CelebrationArt` + `<Confetti trigger={n} />` + `haptic()`.

## 9. Do / Don't

- Do use semantic tokens (`bg-surface`, `text-muted`); don't hard-code hex in screens (brand scales are for illustration-like accents only).
- Do give each screen one hero moment; don't stack several aurora panels.
- Do keep gold for honour/celebration and maroon for official marks; don't use either for generic buttons.
- Do use `text-gold-ink` for gold text; don't put `text-accent` on light backgrounds (fails contrast).
- Do keep 44px targets and existing accessible names; don't swap a `<button>` for a `<div>`.
- Do use `m.*` + `LazyMotion`; don't import `motion` (full bundle) or animate layout on scroll.
- Don't use emoji in UI chrome; don't letter-space Devanagari; don't put essential info only in a tooltip.
- Don't add new web fonts; Fraunces + Inter + Noto Sans Devanagari only.

## 10. Checks

- `npx vitest run` — includes token contrast (`src/styles/contrast.test.ts`), the emoji guard (`src/styles/noEmoji.test.ts`), i18n parity.
- `/styleguide` — compare Light | Dark side by side after any token change.
- New strings for the design system live in `src/i18n/designEn.ts` / `designHi.ts` (spread into en/hi).
