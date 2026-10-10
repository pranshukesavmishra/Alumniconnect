import type { ReactNode } from 'react'
import { Page, PageHeader } from '../../components/layout/AppShell'
import { ButtonLink } from '../../components/ui/Button'
import { Card, EmptyState, Notice } from '../../components/ui/Display'

function Prose({ children }: { children: ReactNode }) {
  return <div className="space-y-4 text-[15px] leading-relaxed [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">{children}</div>
}

export function AboutPage() {
  return (
    <div>
      <PageHeader title="About JEC" back="/" />
      <Page className="space-y-5">
        <Card className="flex items-center gap-4 p-5">
          <img src="/jec-logo.png" alt="Jabalpur Engineering College crest" className="h-24 w-auto shrink-0" />
          <div>
            <h2 className="text-lg font-bold">Jabalpur Engineering College</h2>
            <p className="text-sm text-muted">Onwards on wings. Established 1947, the oldest technical institution in Central India.</p>
          </div>
        </Card>
        <Card className="flex items-center gap-4 p-5">
          <img src="/gec-crest.png" alt="Earlier crest of Government Engineering College, Jabalpur" className="h-24 w-auto shrink-0 rounded-lg bg-white p-1" />
          <div>
            <h2 className="text-lg font-bold">Formerly Government Engineering College, Jabalpur</h2>
            <p className="text-sm text-muted">Many alumni still say GEC Jabalpur. Both names are welcome here, and you will find the same college under either.</p>
          </div>
        </Card>
        <Card className="flex items-center gap-4 p-5">
          <img src="/jecaa-logo.png" alt="JECAA, Jabalpur Engineering College Alumni Association" className="h-24 w-auto shrink-0 rounded-lg bg-white p-1" />
          <div>
            <h2 className="text-lg font-bold">JECAA, the Alumni Association</h2>
            <p className="text-sm text-muted">The Jabalpur Engineering College Alumni Association. JEC Alumni Connect is the place where its members find each other, share news and meet.</p>
          </div>
        </Card>
        <div className="flex flex-wrap gap-3">
          <ButtonLink to="/privacy" variant="secondary">Privacy</ButtonLink>
          <ButtonLink to="/terms" variant="secondary">Terms</ButtonLink>
        </div>
      </Page>
    </div>
  )
}

// DRAFT wording for committee approval (plan Section 12, item 9).
export function PrivacyPage() {
  return (
    <div>
      <PageHeader title="Privacy notice" back="/" />
      <Page>
        <Notice tone="warning" className="mb-5" title="Draft for committee approval" />
        <Prose>
          <p>
            JEC Alumni Connect is run by the JEC alumni community for Jabalpur Engineering College alumni, students and faculty. This notice explains what we
            collect and why, in line with India’s Digital Personal Data Protection Act, 2023.
          </p>
          <h2>What we collect</h2>
          <ul>
            <li>Sign-in details: your name, email and profile photo from Google or LinkedIn, or your email if you sign in with a code.</li>
            <li>Your profile: branch, batch, city, work and education, and anything else you choose to add or import from LinkedIn.</li>
            <li>Your mobile number, which is private: only you and event organisers can see it.</li>
            <li>For events: who is attending with you, food and T-shirt preferences, payment references and screenshots you upload.</li>
            <li>Photos you upload.</li>
            <li>
              Your city, only if you turn on “Share my city” (off by default). Your phone’s location is read once, in the foreground, while the app is
              open. We round it to an area of about 5 km before saving it, and work out the nearest city on our own server, so your position is not sent to
              any outside service. We never track you in the background.
            </li>
          </ul>
          <h2>How we use it</h2>
          <ul>
            <li>To run the alumni network: showing your profile to verified JEC members, and helping people find batchmates.</li>
            <li>To run events: registrations, payment verification, name badges, food planning and check-in.</li>
            <li>We never sell your data or use it for advertising. We never message people on your behalf.</li>
          </ul>
          <h2>Who can see what</h2>
          <ul>
            <li>Your profile is visible only to verified members. Your phone number, payments and tickets are visible only to you and the organisers.</li>
            <li>Payment screenshots are stored privately and seen only by the treasurers.</li>
            <li>
              If you share your city, other verified members see your city and an approximate distance (for example “about 40 km”), never a map position or
              coordinates. Members you have blocked do not see you. Turn sharing off in your profile at any time: your saved location is deleted straight away.
            </li>
          </ul>
          <h2>Your choices</h2>
          <ul>
            <li>You can edit your profile at any time.</li>
            <li>You can ask for a copy of your data, or for your account to be deleted, by writing to the contact below. Payment records are kept as long as the law requires.</li>
          </ul>
          <h2>Contact (grievance officer)</h2>
          <p>To be confirmed by the alumni committee.</p>
          <h2>Credits</h2>
          <p>
            City names and positions come from <a className="font-semibold text-primary" href="https://www.geonames.org" target="_blank" rel="noopener noreferrer">GeoNames</a>,
            licensed under <a className="font-semibold text-primary" href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">Creative Commons Attribution 4.0</a>.
            The optional map uses © <a className="font-semibold text-primary" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors
            and Leaflet (BSD 2-Clause).
          </p>
        </Prose>
      </Page>
    </div>
  )
}

export function TermsPage() {
  return (
    <div>
      <PageHeader title="Event terms" back="/meet" />
      <Page>
        <Notice tone="warning" className="mb-5" title="Draft for committee approval" />
        <Prose>
          <ul>
            <li>Your place is confirmed only after the organisers verify your payment. You will see “Confirmed” and an entry pass in the app.</li>
            <li>Pay the exact amount shown, using the UPI details on your registration page, and enter the 12-digit UPI reference (UTR).</li>
            <li>Each entry pass admits the number of people shown on it. Please carry a photo ID.</li>
            <li>Refunds and cancellations: policy to be confirmed by the committee.</li>
            <li>Photos and videos will be taken at the event. If you prefer not to appear in shared photos, untick the photo option when registering and tell the photographers.</li>
            <li>The organisers may update the programme; changes will be shown in the app.</li>
          </ul>
        </Prose>
      </Page>
    </div>
  )
}

export function InstallPage() {
  return (
    <div>
      <PageHeader title="Add to your home screen" back="/" />
      <Page className="space-y-4">
        <p className="text-muted">Open the app from your home screen like any other app, with your ticket one tap away.</p>
        <Card className="p-4">
          <p className="font-semibold">Android (Chrome)</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[15px]">
            <li>Tap the ⋮ menu at the top right.</li>
            <li>Tap “Add to Home screen” or “Install app”.</li>
          </ol>
        </Card>
        <Card className="p-4">
          <p className="font-semibold">iPhone (Safari)</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[15px]">
            <li>Tap the Share button at the bottom.</li>
            <li>Scroll down and tap “Add to Home Screen”.</li>
          </ol>
        </Card>
      </Page>
    </div>
  )
}

export function NotFoundPage() {
  return (
    <EmptyState title="Page not found" action={<ButtonLink to="/">Go home</ButtonLink>}>
      The link may be old or mistyped.
    </EmptyState>
  )
}
