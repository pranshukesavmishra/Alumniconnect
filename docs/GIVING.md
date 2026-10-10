# Give Back: appeals, donations, sponsors

The **Give back** module lets the committee launch fund appeals from the app and lets every verified member fund them.
Money goes by **UPI to the association's own account**. There is no payment gateway and no card data. The donor pays in their UPI app,
types the 12-digit **UTR** (the reference number their app shows), and the treasurer confirms it against the bank statement, exactly
like event payments. Amounts are whole **paise** inside the app; one gift is between ₹10 and ₹10,00,000.

## What members see

| Screen | Where |
|---|---|
| Hub: featured appeal with animated progress, appeals by kind (Projects, Scholarships, Adopt a lab or classroom, Alumni fund, Drives), department filter, Reunion Fund card | `/give` |
| An appeal: cover, story, goal and raised, countdown, milestones, items to adopt, updates, sponsors, batch leaderboard, donor wall, share on WhatsApp, "remind me later" | `/give/<name>` |
| My giving: every gift with its status, receipts, my reminders, opt out of "new appeal" notifications | `/give/mine` |
| Receipt (printable) | `/give/receipt/<id>` |
| Where the money went: totals, spending per appeal, sponsorship income, every expense with its bill | `/give/where-it-went` |
| Home: a card for the featured appeal | Home |

Privacy rules the database enforces: donors' phone and e-mail are never shown to members; an **anonymous** gift shows "A JECian" with no
name, batch, message or dedication on the wall, and is left out of the batch leaderboard (its amount is shown as one separate line).
Only admins who can **verify donations** see who gave anonymously.

The **Reunion Fund** card shows what members added to their Alumni Meet registration. That money is read from the registrations and is
never counted again inside an appeal.

## What the committee does (Organise → Funds)

Tabs: **Appeals**, **Verify**, **Sponsors**, **Expenses**, **Reports**, **Settings**. What each person sees depends on their permissions
(`funds_manage`, `funds_verify`, `funds_reports`, `sponsors_manage`; see ADMIN_ACCESS.md). The **Funds & treasury** preset ticks all four.

### Launch the Convocation Hall appeal, step by step

1. **Settings** tab: enter the default **UPI id** of the association's bank account, the payee name, the association name and details
   (address, registration number) and a receipt footer. Add the **tax-exemption text only if the association really holds the
   certificate** (for example 80G); it is printed on receipts only when filled in. Add the **notice for donors abroad** (see the
   checklist below). Save.
2. **Appeals** tab → **New appeal**. Kind: *Project (crowdfunding)*. Title: "Build the Convocation Hall". Add a one-line summary, the story,
   the goal (for example ₹50,00,000), a closing date, suggested amounts (for example 1000, 5000, 25000, 100000) and a cover picture.
3. **Milestones**: for example 25% "Foundation stone", 50% "Walls up", 75% "Roof", 100% "Inauguration", each with what it unlocks.
   Donors are notified when a milestone is reached.
4. **Items** (optional, mainly for adopt-a-lab appeals): "Stage ₹4,00,000", "Lights ₹1,00,000". Members can fund a whole item or part of it.
5. **Create draft**, check it with **View as member** (drafts are visible only to the committee), then **Publish**. Every verified member
   gets a "new appeal" notification (unless they opted out). **Feature** it to put it on Home and at the top of the hub.
6. As gifts arrive: **Verify** tab. Verify one by one, select several, or upload the bank statement (CSV or Excel) and verify every gift
   whose UTR and amount match exactly. A UTR already used by an event payment or another gift is refused. Donors get a thank-you
   notification and a numbered receipt (JEC-GV-year-number). Use **Not received** (with a reason the donor sees) when the money is not in the account.
7. Cash, cheque and bank gifts: **Record a cash, cheque or bank gift** (needs a reason, goes straight to verified).
8. Post **updates** on the appeal (a notification goes to donors), and log spending in **Expenses** with a photo of the bill. Members see
   all of it under *Where the money went*.
9. When done: **Complete** the appeal (it stops taking gifts) or **Pause** it. A refund (in the Verify tab) takes a gift out of the totals.

Reminders: members who set "remind me" get a notification on their date (once, or every month). Donors and pledgers are told when an
appeal ends in 3 days. Reminders run hourly from the database (pg_cron) and also whenever someone opens the Give back page.
Nothing is ever debited automatically.

### Sponsorship (events and appeals)

**Sponsors** tab: choose the event (or appeal).

* **Packages**: tiers such as Title sponsor, Gold, Silver, Supporter, In-kind, each with a price, a number of slots and a list of benefits.
  The page shows sold and available. A package cannot be sold beyond its slots.
* **Pipeline**: lead → contacted → proposal sent → committed → paid → delivered (or declined). Each sponsor has an owner, a follow-up date
  (the owner is notified that day), notes, and a **deliverables checklist** with due dates (logo received, banner printed, stage mention done…).
  Members who answered "yes, I would like to sponsor" on the registration form appear as **suggested leads** with their organisation and
  note; **Add to pipeline** turns one into a sponsor. Members can also tell the committee from an appeal page.
* **Payment**: record the sponsor's payment with its UTR. It waits in the same **Verify** queue (kind "sponsorship") and, once verified,
  the sponsor becomes **Paid** automatically. A refund puts them back to committed. Cash and cheque need `funds_verify` as well.
* **In-kind** sponsors (goods or services) carry an estimated value that is shown **separately** and is never added to cash totals.
* **Wall**: paid sponsors (in-kind sponsors once committed) appear by tier as logos on the Meet page, on the appeal page and in a corner of
  the live photo slideshow. Every logo links to the sponsor's own website (`rel="noopener"`, no tracking). Contact details are visible to
  sponsor managers only.
* **Documents**: printable **proposal**, **agreement** and **invoice / receipt** using the association details and footer from Settings.

### Reports and exports

**Reports** tab (`funds_reports`): by appeal, batch, department, month and donor; sponsorship target vs raised, by tier and outstanding
commitments. **Download CSV** writes an entry to the activity log first; cells starting with `=`, `+`, `-` or `@` are neutralised so they
cannot run in a spreadsheet. Without `funds_verify`, anonymous donors appear as "A JECian" in reports too.

## Legal checklist the committee must confirm before going live

The app collects and records money; **the committee carries the legal responsibility**. Confirm each point with your office bearers
(and a chartered accountant where needed) before publishing the first appeal:

- [ ] The association is a **registered society or trust** (registration number and address entered in Settings so receipts carry them).
- [ ] The UPI id belongs to a **bank account in the association's name**, operated by authorised signatories. Never use a personal account.
- [ ] If receipts will mention **tax exemption** (80G / 12A), the association holds a valid certificate. Enter that text in Settings **only then**. Leave it empty otherwise.
- [ ] **Foreign contributions**: accepting money from donors outside India is governed by the Foreign Contribution (Regulation) Act. Check whether the association holds the required registration or permission **before** accepting such gifts, and fill in the notice for donors abroad accordingly (for example "We cannot accept foreign contributions yet").
- [ ] The committee has agreed who verifies donations, who may approve expenses, and how the books are audited. Everything done here is in the activity log.
- [ ] Sponsorship agreements and any GST treatment of sponsorship income have been checked with the accountant.
- [ ] A refund policy is agreed (refunds are recorded by a `funds_verify` admin; the money itself is returned outside the app).

## For developers

* Migrations `20261017000060_giving.sql` (appeals, donations, pledges, expenses, settings, functions) and `20261017000061_sponsorship.sql`
  (packages, sponsors, pipeline, deliverables, sponsorship payments through `giving_donations`).
* No table is readable or writable through the API: every read and write is a SECURITY DEFINER function with `search_path = ''`
  (`giving_*` for members, `admin_giving_*` and `admin_sponsor_*` for the committee) that checks `_admin_can(...)` and writes `_audit`.
* Totals are never stored: they are summed from **verified** `giving_donations` rows. Event payments and donations share one UTR space
  (`_giving_utr_taken` and a patch of `submit_upi_payment`).
* Images (covers, update pictures, expense bills, logos) live in the public `giving` storage bucket, uploaded by admins with `funds_manage` or `sponsors_manage`.
* Tests: `supabase/tests/99_giving.sql`, the admin functions in `99_safety_matrix.sql`, `src/features/giving/helpers.test.ts`, `e2e/giving.spec.ts`.
