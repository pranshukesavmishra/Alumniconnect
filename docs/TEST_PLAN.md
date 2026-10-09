# Closed-test plan (before the Play Store)

Goal: prove the app works for real people on real phones before it is public. Run it in two rounds, as in
[ANDROID.md](ANDROID.md): **internal testing** (5–10 people, a few days), then **closed testing** (20–50 alumni, 2 weeks).
Do not go to production until the exit checklist at the bottom is ticked.

## Who to invite

Aim for a mix, not just friends of the organisers:

- 3+ phone brands (Samsung, Xiaomi/Redmi, Vivo/Oppo, Pixel/OnePlus) and 1–2 older or low-memory phones
- 2+ people abroad (different time zone, no Indian UPI)
- 2+ people from each of a few batches (2003, 2007, 2012), at least one M.E. and one MCA alumnus
- 1–2 people who are not technical, and who have never seen the app
- The organising team: an admin, a treasurer, a check-in volunteer

Give each tester a name, phone model and Android version in a shared list. Ask them to report problems in the Help
chat/group with a screenshot, what they tapped, and what they expected.

## Round 1 – internal (5–10 people)

Each tester follows the **core journey** below on their own phone and ticks every line. The organisers watch for
anything confusing, even if it "works".

### A. Install and sign in
- [ ] Install from the Play internal-test link; the app opens full screen with no address bar
- [ ] Sign in with Google; sign in with LinkedIn; sign in with email link (each tester tries one)
- [ ] Sign out and back in; close and reopen the app (still signed in)
- [ ] Switch language to Hindi and back; all main screens read correctly, nothing overflows

### B. Profile
- [ ] Onboarding asks only for what the profile needs; batch and branch lists match the college's
- [ ] Import from LinkedIn (PDF or profile) fills work history; profile photo imports and can be changed or removed
- [ ] Edit headline, city, skills; changes show on the profile and in the directory
- [ ] "Download my data" produces a file; phone and email are not visible to other members

### C. Directory, connections, chat
- [ ] Search by name, batch, branch, city, company; open a profile
- [ ] Send, accept and decline a connection request
- [ ] Direct chat: text, emoji reaction, reply, edit, delete, photo, voice note, file
- [ ] Group chat: join a batch community late and read the earlier messages
- [ ] Turn on notifications; a message sent while the app is closed produces a notification; tapping it opens the chat
- [ ] Airplane mode: the app opens, shows what it had, and a message sent offline goes out when back online
- [ ] Report a message or post; block a member (they no longer appear)

### D. Feed, jobs, help, business, mentors
- [ ] Post text and photos; like, comment; delete own post
- [ ] Post a job; apply/refer; the post expires on its date
- [ ] Ask for help; someone else offers help
- [ ] Add a business; find it in the directory
- [ ] Offer to mentor / request a mentor; accept and decline

### E. Alumni Meet registration
- [ ] Open the Grand Reunion page; dates, venue and tickets are correct
- [ ] Register: details come from the profile and are not asked again; choose days, add family, food, T-shirt
- [ ] Reunion Fund, sponsorship, performance, volunteering and feedback questions can be answered or skipped as designed
- [ ] The total shown equals what the organisers expect (check against a calculator)
- [ ] Pay by UPI and submit the reference number; an abroad tester uses the alternative payment route
- [ ] After the organiser verifies, the ticket shows a QR; it opens with no internet
- [ ] Edit feedback after paying; try to change tickets after paying (should be blocked with a clear message)
- [ ] Cancel and re-register where allowed

### F. Nearby (if enabled)
- [ ] "Share my city" is off until the tester turns it on; the explanation is clear
- [ ] Permission denied: the app explains and still works
- [ ] Search a city; results show approximate distance only; open a profile and start a chat
- [ ] Turn sharing off; the tester no longer appears for others

### G. Organisers (admin, treasurer, check-in)
- [ ] Admin home shows "needs your attention"; every item opens the right screen
- [ ] Global search finds a member, a ticket code and a UPI reference
- [ ] Verify and reject a payment with a reason; the member is notified
- [ ] Check in a ticket by scanning the QR and by searching the code; a second scan says "already checked in"
- [ ] Responses tab shows every answer; the spreadsheet download opens correctly
- [ ] The activity log shows who did what

## Round 2 – closed testing (20–50 alumni)

Same journey, but let people use it naturally for two weeks. Each week the organisers:

1. Look at the in-app Analytics page and the support questions; write down the top 5 confusions and fix them.
2. Run a **restore rehearsal** from the encrypted backup (see [BACKUP_RESTORE.md](BACKUP_RESTORE.md)).
3. Check the Supabase usage (database size, storage, monthly active users) against the free-plan limits.
4. Send a test announcement push notification and confirm delivery on every phone brand.

Special days:

- **Registration dress rehearsal (at least 10 testers at once):** everyone registers and pays a test amount (₹1) in the same hour; the treasurer verifies all of them; nothing is lost or double-counted.
- **Entry-day dress rehearsal:** 3 volunteers check in 20 testers with the QR, with Wi-Fi off on one phone.

## What to record for every problem

Phone model and Android version, app version, time, steps, screenshot, whether it can be repeated. Label each as
**blocker** (cannot register, pay or enter; data loss; privacy leak), **major** (feature broken, workaround exists) or
**minor** (wording, spacing).

## Exit checklist (all must be true before production)

- [ ] No open blocker; every major issue fixed or consciously accepted by the organisers
- [ ] At least 20 testers completed section E end to end, including 2 from abroad
- [ ] The payment verification flow was done with real UPI transfers and the money matched the app's totals
- [ ] The QR check-in dress rehearsal passed, including offline
- [ ] A backup restore rehearsal passed within the last 2 weeks
- [ ] Push notifications arrived on every tested phone brand
- [ ] The privacy page, Data safety form and Terms are filled in and match what the app really does (location is foreground and approximate only)
- [ ] The Play Console shows no pre-launch report crashes
- [ ] Production rollout is set to **staged** (10% → 50% → 100%), with someone watching the Help group
