"""Builds docs/JEC_Build_Plan_Phase1.pdf. Run: python3 docs/build_phase1_plan_pdf.py"""
import os

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import BaseDocTemplate, Frame, NextPageTemplate, PageBreak, PageTemplate, Spacer, Table, TableStyle

from build_plan_pdf import (
    CONTENT_W, CREAM, LINE, MARGIN, MARIGOLD, MUTED, NAVY, NAVY_DARK, P, PAGE_H, PAGE_W,
    bullets, callout, h2, section, table,
)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "JEC_Build_Plan_Phase1.pdf")
FOOTER = "JEC Alumni Connect · Build plan, Phase 1 · v1.0"


def on_cover(c, doc):
    c.saveState()
    c.setFillColor(NAVY_DARK)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    c.setFillColor(NAVY)
    c.circle(PAGE_W + 20, PAGE_H - 120, 260, stroke=0, fill=1)
    c.setFillColor(MARIGOLD)
    c.rect(MARGIN, PAGE_H - 250, 60, 5, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont("Body-Bold", 13)
    c.drawString(MARGIN, PAGE_H - 200, "JEC ALUMNI CONNECT")
    c.setFont("Body-Bold", 38)
    c.drawString(MARGIN, PAGE_H - 295, "Build plan, Phase 1")
    c.setFont("Body", 17)
    c.setFillColor(colors.HexColor("#C9D4EA"))
    c.drawString(MARGIN, PAGE_H - 325, "The app foundation and the Alumni Connect Grand Reunion 2026 (batches 2003–2012)")
    c.setFont("Body", 13)
    c.drawString(MARGIN, PAGE_H - 372, "What we build, in what order, how we guarantee quality,")
    c.drawString(MARGIN, PAGE_H - 390, "and the decisions we need from the committee.")
    c.setFillColor(MARIGOLD)
    c.setFont("Body-Bold", 13)
    c.drawString(MARGIN, PAGE_H - 420, "Version 1.0  ·  8 October 2026  ·  For team review")
    c.setFillColor(colors.HexColor("#C9D4EA"))
    c.setFont("Body", 10.5)
    c.drawString(MARGIN, 70, "Companion to the product plan (JEC_Alumni_Connect_Plan.pdf, v2.0).")
    c.drawString(MARGIN, 55, "Nothing goes live until every item in Section 10 is signed off.")
    c.restoreState()


def on_page(c, doc):
    c.saveState()
    c.setStrokeColor(LINE)
    c.line(MARGIN, 14 * mm, PAGE_W - MARGIN, 14 * mm)
    c.setFont("Body", 8.5)
    c.setFillColor(MUTED)
    c.drawString(MARGIN, 10 * mm, FOOTER)
    c.drawRightString(PAGE_W - MARGIN, 10 * mm, str(doc.page))
    c.restoreState()


def build():
    st = [NextPageTemplate("main"), PageBreak()]

    # Contents
    st += [P("Contents", "h1"), Spacer(1, 6)]
    toc = ["What we build first, and why", "The quality bar", "Platform choices that last for years",
           "Photos and your Google Drive", "LinkedIn profile import: what is possible",
           "Alumni Meet 2026: complete scope", "Payments", "Security and privacy",
           "Testing and release process", "Go-live checklist", "Schedule: day by day",
           "What we need from you", "Risks and how we handle them"]
    rows = [[P(f"<font color='#14306B'><b>{i + 1:02d}</b></font>", "toc"), P(t, "toc")] for i, t in enumerate(toc)]
    t = Table(rows, colWidths=[14 * mm, CONTENT_W - 14 * mm])
    t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
                           ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    st.append(t)
    st.append(Spacer(1, 14))
    st.append(callout("<b>In one paragraph:</b> we build the real JEC Alumni Connect app, phone-first, and its first "
                      "feature is everything the Alumni Meet 2026 needs. Registration and payment go live in 5 days; "
                      "check-in, the photo gallery and the Android app follow well before the meet in December. "
                      "Every alumnus who registers becomes a member, so the meet also launches the app. "
                      "The rest of the app (feed, batch groups, messages, circles, invites) follows from January, "
                      "as in the product plan v2.0."))

    # 01
    st += section(1, "What we build first, and why")
    st.append(P("The Grand Reunion for batches 2003–2012 on 26–27 December needs registrations, payments and photos handled "
                "through the app. We build it as part of the full app, not as a throwaway website, for three reasons:"))
    st += bullets([
        "<b>One sign-up, forever.</b> Everyone who registers for the meet gets a profile in JEC Alumni Connect. "
        "Hundreds of senior alumni join in one go, and the app never starts empty.",
        "<b>No double work.</b> Sign-in, profiles, photos and admin tools built now are the same ones the full app uses.",
        "<b>One impression.</b> The first thing senior alumni see is the real product, polished.",
    ])
    st += h2("Three releases")
    st.append(table([
        ["Release", "When", "What it contains"],
        ["<b>1A: Registration opens</b>", "Day 5 (after the committee's dry run)",
         "Sign-in (Google, LinkedIn, email code), quick profile, meet registration with family members, server-calculated "
         "fees, UPI payment, payment verification by treasurers, e-ticket with QR code, confirmation emails, organiser "
         "dashboard with Excel export, profile photo and throwback photo upload, LinkedIn import"],
        ["<b>1B: Ready for the meet</b>", "Before end of November",
         "Gate check-in scanner (works on weak network), event photo upload and gallery, originals archived to Google "
         "Drive, \"who's coming from my batch\", reminders, alumni directory, Android app on the Play Store"],
        ["<b>2: The full app</b>", "From January", "Feed, batch groups, messages, connections, circles, invites, "
                                                    "badges, as in product plan v2.0"],
    ], [0.22, 0.2, 0.58]))
    st.append(Spacer(1, 6))
    st.append(callout("<b>Why split 1A and 1B:</b> registration and payment are needed in 5 days; check-in and the "
                      "gallery are only needed in December. Splitting lets us spend the first 5 days making "
                      "registration and payment flawless instead of rushing everything.", bg=CREAM, bar=MARIGOLD))

    # 02
    st += section(2, "The quality bar",
                  "Our users are senior professionals, many of them leaders in software. We build to the standard "
                  "they expect at work.")
    st += h2("Promises we keep in every release")
    st.append(table([
        ["Promise", "How we guarantee it"],
        ["Money is always right", "Fees are calculated only on the server, never in the phone. Every rupee has a trail: "
                                  "who paid, the UPI reference, who verified it, and when. A UPI reference can only be "
                                  "used once."],
        ["Private data stays private", "Phone numbers, payments and tickets are visible only to their owner and the "
                                       "organisers. Enforced by database rules, and tested automatically."],
        ["Nothing ships untested", "Automated tests for every security rule, every fee calculation and the full "
                                   "register-pay-verify-ticket journey run before every release."],
        ["Works on every phone", "Checked on a low-cost Android phone, an iPhone and a desktop, in light and dark mode, "
                                 "with large text."],
        ["No surprises in production", "A separate test copy (staging) for trying changes. The live app only changes "
                                       "after tests pass and someone has checked staging."],
        ["Nothing is ever lost", "Nightly backup of registrations and payments to the committee's Google Drive."],
        ["Problems found before users report them", "Error monitoring alerts us the moment something fails."],
    ], [0.27, 0.73], first_bold=True))
    st += h2("The experience bar")
    st += bullets([
        "Register for the meet in <b>under 3 minutes</b> on a phone, without creating a password.",
        "Every screen answers \"where am I and what happens next?\", e.g. \"Payment received. The treasurer will "
        "verify it within 24 hours. We'll email you.\"",
        "Forms remember what you typed if the network drops or you switch apps to pay.",
        "Large, readable text and big buttons, so it works for every age group.",
        "Fast on 4G: the first screen loads in under 2 seconds.",
    ])

    # 03
    st += section(3, "Platform choices that last for years",
                  "Each choice is free today, used at large scale, and has a way out if its terms ever change, so the "
                  "app never has to be rebuilt.")
    st.append(table([
        ["Need", "Choice", "Why it lasts", "If it ever changes"],
        ["App code", "React + TypeScript, one codebase", "The most widely used UI technology; easy for future JEC "
                                                         "students to maintain", "-"],
        ["Phone apps", "Installable web app now; Android and iPhone apps from the same code using Capacitor",
         "Real store apps with camera, sharing and notifications, without a second codebase",
         "The web app keeps working on any phone"],
        ["Database, login, files", "Supabase", "Open source, built on PostgreSQL (the standard database)",
         "Export everything any time; run the same open-source system elsewhere without changing the app"],
        ["Hosting", "Cloudflare Pages", "Free, unlimited traffic, fast in India", "Any static host works"],
        ["Photo archive", "The committee's Google Drive (1 TB)", "Huge free space the committee owns", "Download the folder"],
        ["Email", "Brevo (300 emails a day free)", "Reliable delivery", "Any SMTP service"],
        ["Code", "GitHub, under an alumni association account", "Survives when students graduate", "-"],
    ], [0.14, 0.25, 0.33, 0.28], first_bold=True))
    st += h2("Free plan limits and how we stay inside them")
    st.append(table([
        ["Limit (Supabase free plan)", "What it means for us", "Safeguard"],
        ["Pauses after 7 days with no activity", "Not a risk while people use it", "An automatic daily health "
                                                                                  "check keeps it active"],
        ["500 MB database", "Enough for well over 100,000 registrations", "-"],
        ["1 GB file storage", "About 4,000 compressed photos", "Originals go to Drive; photos are compressed on the "
                                                               "phone; alert at 70%"],
        ["5 GB data transfer a month", "Comfortable for registration; the gallery will need care in December",
         "Small thumbnails, caching on the phone; extra free storage on Cloudflare if needed"],
        ["No automatic backups", "-", "Our own nightly backup to Google Drive"],
    ], [0.3, 0.35, 0.35]))
    st.append(Spacer(1, 4))
    st.append(P("<b>When paying would make sense:</b> if usage outgrows the free plan, Supabase Pro costs about "
                "US$25 (around ₹2,100) a month and adds daily backups. Nothing in Phase 1 needs it."))

    # 04
    st += section(4, "Photos and your Google Drive")
    st.append(P("Google Drive is excellent for storing originals but is not built to serve images inside an app "
                "(it is slow and rate-limited when hundreds of people browse at once). So each photo is saved in two places:"))
    st.append(table([
        ["Copy", "Where", "Size", "Used for"],
        ["Original, full quality", "Committee's Google Drive, folder \"JEC Alumni Meet 2026\"", "As taken (3–8 MB)",
         "Archive, downloads, the slideshow, printing"],
        ["Display copy", "Supabase Storage", "About 250 KB", "Viewing a photo in the app"],
        ["Thumbnail", "Supabase Storage", "About 30 KB", "Gallery grids"],
    ], [0.2, 0.36, 0.18, 0.26], first_bold=True))
    st.append(Spacer(1, 6))
    st += bullets([
        "<b>How the app gets access:</b> the committee's Google account approves the app once. The app can only "
        "see and create files it made itself (Google's \"drive.file\" permission). It cannot read anything else "
        "in that Drive.",
        "<b>Uploads go straight from the phone to Drive,</b> so large files don't pass through our server.",
        "<b>Use a dedicated association Google account</b> (for example jecalumni.association@gmail.com) with 1 TB "
        "of storage, rather than a personal account, so the archive stays with the association after any of us "
        "graduates. A personal Drive works too, but ownership has to be handed over later.",
        "<b>Fallback:</b> if Drive isn't connected in time, originals are kept in Supabase and moved to Drive "
        "later. Uploads never stop.",
    ])

    # 05
    st += section(5, "LinkedIn profile import: what is possible",
                  "We want profiles filled in seconds. Here is exactly what LinkedIn allows, so nobody is surprised.")
    st.append(table([
        ["Method", "What we get", "Effort for the member", "Release"],
        ["Sign in with LinkedIn (official)", "Name, photo, email", "One tap", "1A"],
        ["Upload your LinkedIn profile PDF", "Headline, current job, full experience, education, skills",
         "On LinkedIn (desktop): More, then Save to PDF. Upload the file. Review and save.", "1A"],
        ["Upload your LinkedIn data export", "Everything above, most accurate",
         "LinkedIn Settings, Data privacy, Get a copy of your data. LinkedIn emails it in 10 minutes to a day.", "1A"],
        ["LinkedIn profile link", "A \"View on LinkedIn\" button on the profile", "Paste the link", "1A"],
        ["Manual entry", "Anything", "Typing, with suggestions", "1A"],
    ], [0.25, 0.27, 0.38, 0.1], first_bold=True))
    st.append(Spacer(1, 6))
    st.append(callout("<b>Why it can't be fully automatic:</b> LinkedIn only gives full profile data to companies in "
                      "its paid partner programme. Copying data from LinkedIn pages automatically (\"scraping\") "
                      "breaks LinkedIn's terms and can get members' accounts restricted, so we will not do it. "
                      "The PDF upload gives nearly the same result in about 30 seconds, and the member always "
                      "reviews the result before it is saved."))

    # 06
    st += section(6, "Alumni Meet 2026: complete scope")
    st += h2("The attendee's journey")
    st.append(table([
        ["Step", "What the alumnus sees and does", "Release"],
        ["1", "Opens the link from WhatsApp. Event page: date, venue, schedule, fees, and how many have registered "
              "from each batch.", "1A"],
        ["2", "Signs in with Google, LinkedIn, or a code sent to their email. No password.", "1A"],
        ["3", "Quick profile, pre-filled from sign-in: name, branch, passing-out year, city, mobile.", "1A"],
        ["4", "Registration: who is coming (self, spouse, children by age group), T-shirt sizes, food preference, "
              "accommodation needed, arrival details, special requirements. Accepts terms and photo consent.", "1A"],
        ["5", "Sees the fee breakdown, calculated by the server.", "1A"],
        ["6", "Pays: on a phone, \"Pay with UPI\" opens GPay, PhonePe or Paytm with the amount and reference filled in; "
              "on a computer, a QR code to scan. Then enters the 12-digit UPI reference (optional screenshot).", "1A"],
        ["7", "Status: \"Payment received, being verified\". When the treasurer verifies: \"Confirmed\", an e-ticket "
              "with a QR code, a confirmation email, Add to calendar and Share on WhatsApp.", "1A"],
        ["8", "Can change food and T-shirt choices until a lock date; uploads old college photos for the "
              "\"Then and Now\" slideshow.", "1A"],
        ["9", "Sees who from their batch is coming (members who agree to be shown); gets reminders a week and a "
              "day before.", "1B"],
        ["10", "At the gate: shows the QR code; a volunteer scans it; welcome.", "1B"],
        ["11", "Uploads and browses event photos; downloads favourites.", "1B"],
    ], [0.07, 0.83, 0.1]))
    st += h2("Organiser tools")
    st.append(table([
        ["Tool", "What it does", "Release"],
        ["Dashboard", "Registrations, people attending, money received and pending, by batch and branch; food, "
                      "T-shirt and accommodation counts", "1A"],
        ["Payment verification", "Queue of payments with amount, UPI reference and screenshot. Approve, or reject with a "
                                 "reason the member sees", "1A"],
        ["Bank statement matching", "Upload the bank statement (Excel or CSV): the app matches UPI references and amounts "
                                    "and verifies all matches in one click; mismatches are listed for review", "1A"],
        ["Desk payments", "Record cash, bank transfer or a fee waiver, with a note", "1A"],
        ["Exports", "Excel/CSV of registrations, attendees, payments, food and T-shirt lists, name badges", "1A"],
        ["Event settings", "Edit dates, venue, fees, deadlines, UPI ID and text without touching code", "1A"],
        ["Roles", "Admin, treasurer (payments), check-in volunteer (scanner only)", "1A"],
        ["Check-in scanner", "Camera scanner on any phone; manual code entry; keeps working when the network "
                             "is weak and syncs later", "1B"],
        ["Photo moderation", "Hide or remove any photo; feature the best ones", "1B"],
    ], [0.22, 0.68, 0.1], first_bold=True))
    st += h2("Registration statuses")
    st.append(P("<b>Payment pending</b> (registered, not yet paid), then <b>Under verification</b> (UPI reference "
                "submitted), then <b>Confirmed</b> (payment verified; e-ticket issued). A rejected payment returns "
                "to Payment pending with the reason. <b>Cancelled</b> is available for unpaid registrations; "
                "refunds follow the committee's policy and are recorded by the treasurer."))
    st += h2("Emails sent automatically")
    st += bullets([
        "Registration received, with payment instructions.",
        "Payment received, being verified.",
        "Confirmed, with the e-ticket. Or payment not verified, with the reason and what to do.",
        "Reminders 7 days and 1 day before the meet (1B).",
        "WhatsApp messages are not sent automatically: WhatsApp's business messaging is paid. Instead, every "
        "ticket and invite has a one-tap Share on WhatsApp button.",
    ])

    # 07
    st += section(7, "Payments", "A decision for the committee. Our recommendation is option A for launch.")
    st.append(table([
        ["", "A. UPI to the association's account (recommended)", "B. Payment gateway (Razorpay or Cashfree)"],
        ["Cost", "₹0", "About 2% + GST per payment (around ₹47 on ₹2,000)"],
        ["Confirmation", "Treasurer verifies; bank statement matching verifies hundreds in minutes",
         "Automatic and instant"],
        ["Payment methods", "Any UPI app", "UPI, cards, net banking, wallets"],
        ["Setup", "A UPI ID or merchant QR on the association's bank account. Ready today",
         "KYC with PAN and bank account; activation can take several working days"],
        ["Risk", "Manual step, which we make fast and accurate", "Fees; activation delay before the deadline"],
    ], [0.17, 0.42, 0.41], first_bold=True))
    st.append(Spacer(1, 6))
    st += bullets([
        "We recommend a <b>free business UPI QR</b> (for example PhonePe Business or Paytm for Business) or the "
        "bank's merchant UPI, linked to the association's account. Personal UPI IDs can hit daily limits or get "
        "flagged when hundreds of payments arrive.",
        "Option B can be switched on later without changing anything else in the app.",
        "Refund policy, late fees and the last date for registration are set by the committee and shown clearly "
        "before payment.",
    ])

    # 08
    st += section(8, "Security and privacy")
    st += bullets([
        "<b>No passwords to steal:</b> sign-in with Google, LinkedIn or a one-time email code.",
        "<b>Rules inside the database:</b> even if someone tampers with the app, the database refuses to show "
        "another person's phone number, payment or ticket, and refuses to let anyone change a fee or approve "
        "their own payment.",
        "<b>Roles:</b> admins (full access), treasurers (payments), check-in volunteers (scanner only). Every "
        "approval records who did it and when.",
        "<b>Payment screenshots</b> are stored privately, visible only to the member and treasurers.",
        "<b>India's DPDP Act 2023:</b> a clear privacy notice at registration, consent for photos, data used only "
        "for the purpose stated, and deletion on request.",
        "<b>Admin accounts</b> must use Google accounts with 2-step verification turned on.",
    ])

    # 09
    st += section(9, "Testing and release process")
    st.append(table([
        ["Layer", "What is tested", "When"],
        ["Database rules", "Each security rule: a member can't read others' registrations, can't change a fee, can't "
                           "verify their own payment, can't reuse a UPI reference; a volunteer can't see payments", "Every change"],
        ["Business logic", "Fee calculation for every combination of tickets; status changes; deadline and capacity "
                           "checks", "Every change"],
        ["End-to-end", "On a phone-sized screen: sign in, register, pay, treasurer verifies, ticket appears, "
                       "export is correct", "Every release"],
        ["Devices", "Low-cost Android (Chrome), iPhone (Safari), desktop; light and dark; large text", "Every release"],
        ["Committee dry run", "5 committee members register and pay ₹1 on staging; treasurer verifies; everyone "
                              "reports anything confusing", "Day 5, before going live"],
    ], [0.18, 0.64, 0.18], first_bold=True))

    # 10
    st += section(10, "Go-live checklist",
                  "Registration does not open until every line is ticked by two people.")
    st.append(table([
        ["#", "Check"],
        ["1", "Event name, dates, venue and schedule match the committee's final text"],
        ["2", "Every fee amount and category checked by two committee members"],
        ["3", "UPI ID and payee name checked by two people with a real ₹1 payment that shows up in the bank account"],
        ["4", "Registration deadline, refund policy and contact numbers are correct"],
        ["5", "Admin and treasurer accounts work; volunteers have scanner-only access"],
        ["6", "Confirmation emails arrive (Gmail, Outlook, Yahoo), not in spam"],
        ["7", "Sign-in works with Google, LinkedIn and email code on Android, iPhone and desktop"],
        ["8", "All automated tests pass on the release version"],
        ["9", "Nightly backup to Google Drive has run once successfully"],
        ["10", "Privacy notice, terms and photo consent approved by the committee"],
        ["11", "Dry-run feedback fixed and re-checked"],
    ], [0.07, 0.93]))

    # 11
    st += section(11, "Schedule: day by day")
    st.append(table([
        ["Day", "Build", "Ready to see at the end of the day"],
        ["1", "Database, security rules and their tests; design system; sign-in (Google, LinkedIn, email code); "
              "quick profile", "Sign in and create a profile on a phone"],
        ["2", "Event page; registration with family members; server-side fees; UPI payment; status page; e-ticket; "
              "emails", "Register and pay end to end on staging"],
        ["3", "Organiser dashboard; payment verification; bank statement matching; desk payments; exports; event "
              "settings; roles", "Treasurer verifies payments; Excel export"],
        ["4", "Profile photo and throwback upload with the Drive archive; LinkedIn PDF and data-export import; full "
              "test pass; fixes", "Complete Release 1A on staging"],
        ["5", "Committee dry run; fixes; production setup with real details; go-live checklist", "Registration opens"],
        ["Weeks 2–7", "Check-in scanner, gallery, who's coming, reminders, directory, Android app (Google requires "
                      "a 14-day closed test with 12 testers before a new app can go public)", "Release 1B before the end of November"],
    ], [0.12, 0.58, 0.3], first_bold=True))
    st.append(Spacer(1, 6))
    st.append(P("Each day ends with a short update and a staging link so the team can try what was built."))

    # 12
    st += section(12, "What we need from you",
                  "The days in brackets are when each item is needed. Items 1–5 are blocking: registration cannot "
                  "open without them.")
    st.append(table([
        ["#", "Item", "Needed by"],
        ["1", "<b>Event details:</b> official name, dates, venue, programme schedule", "Day 2"],
        ["2", "<b>Who can attend:</b> is \"2001–2010\" the passing-out year or the joining year? May spouses, "
              "children, faculty or other batches attend?", "Day 2"],
        ["3", "<b>Fees:</b> amount for each category (alumnus, spouse, child age groups, others), what the fee "
              "includes, last date, late fee, refund policy, maximum number of attendees if any", "Day 2"],
        ["4", "<b>Payment account:</b> UPI ID or business QR of the association's account, payee name as shown in "
              "UPI apps, and the 1–2 treasurers who verify payments", "Day 3"],
        ["5", "<b>Admins:</b> Gmail addresses of the organisers who need admin access", "Day 3"],
        ["6", "<b>Accounts</b> (all free, created with an association email; I'll send a step-by-step guide): "
              "Supabase, Cloudflare, Google Cloud (Google sign-in and Drive), LinkedIn developer app, Brevo, GitHub "
              "organisation", "Day 3"],
        ["7", "<b>Google account for photos:</b> the account whose 1 TB Drive stores originals (association account "
              "recommended)", "Day 4"],
        ["8", "<b>Web address:</b> a free address (e.g. jec-alumni.pages.dev), a college subdomain, or your own domain "
              "(about ₹800 a year, looks most professional)", "Day 4"],
        ["9", "<b>Approvals:</b> privacy notice, terms, photo consent and email wording (I'll draft them)", "Day 4"],
        ["10", "<b>Dry run:</b> 5 committee members for 30 minutes on Day 5", "Day 5"],
        ["11", "<b>Registration form:</b> confirm or change the fields in Section 6, step 4", "Day 2"],
    ], [0.06, 0.8, 0.14]))

    # 13
    st += section(13, "Risks and how we handle them")
    st.append(table([
        ["Risk", "What we do"],
        ["Event details arrive late", "We build with sample values on staging; going live is blocked until the real "
                                      "values pass the go-live checklist"],
        ["Hundreds of payments to verify", "Bank statement matching; two treasurers; clear statuses so members don't "
                                           "pay twice"],
        ["Someone enters a wrong or reused UPI reference", "Format check, one-time use, and matching against the bank "
                                                           "statement before confirmation"],
        ["Email limit (300 a day)", "Most people sign in with Google (no email needed); a second free email "
                                    "service as backup"],
        ["Free plan limits", "Compression, usage alerts at 70%, Drive for originals, upgrade path ready"],
        ["Account setup delays", "Staging runs on our test setup; we switch to the association's accounts before go-live"],
        ["Weak network at the venue", "Scanner works offline and syncs later; printed backup list"],
        ["Students graduate", "Association-owned accounts, documentation, juniors on the team"],
    ], [0.32, 0.68], first_bold=True))
    st.append(Spacer(1, 10))
    st.append(callout("<b>Next step:</b> the committee reviews this plan and answers items 1–5 and 11 in Section 12. "
                      "Building continues in parallel on everything that doesn't depend on those answers."))
    return st


def main():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN,
                          bottomMargin=20 * mm, title="JEC Alumni Connect: Build plan, Phase 1",
                          author="JEC Alumni Connect team")
    frame = Frame(MARGIN, 20 * mm, CONTENT_W, PAGE_H - MARGIN - 20 * mm, id="f")
    doc.addPageTemplates([PageTemplate(id="cover", frames=[frame], onPage=on_cover),
                          PageTemplate(id="main", frames=[frame], onPage=on_page)])
    doc.build([Spacer(1, 1)] + build())
    print("wrote", OUT)


if __name__ == "__main__":
    main()
