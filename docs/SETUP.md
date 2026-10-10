# Setting up JEC Alumni Connect (production)

Everything below uses free plans. Do it once, with an **association-owned email** wherever possible, so the app never depends on one student's personal accounts. Allow about 2–3 hours, and keep a private note (not in Drive) of what you created.

| # | What | Why |
|---|---|---|
| 1 | Supabase project | database, sign-in, file storage, server functions |
| 2 | Google sign-in (Google Cloud) | "Continue with Google" |
| 3 | LinkedIn sign-in (LinkedIn Developers) | "Continue with LinkedIn" |
| 4 | Email sending (Brevo) | 6-digit sign-in codes |
| 5 | Google Drive connection | photo originals and nightly CSV backups |
| 6 | Hosting (Cloudflare Pages) | the website / installable app |
| 7 | Nightly backup (GitHub Actions) | encrypted database backups outside Google Drive; keeps Supabase awake |
| 8 | First super admin, the event, the go-live checklist | |

---

## 1. Supabase

1. Create a free account at supabase.com and a **new project**. Choose region **Mumbai (ap-south-1)** and save the database password in a password manager.
2. On your computer, install Node.js 22, clone this repository, then run:
   ```bash
   npm install
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push          # creates all tables, rules and storage buckets
   ```
   Do **not** run `supabase/seed.sql` on production. It contains sample data only.
3. **Project Settings → API:** note the *Project URL* and the *anon public* key. Both are safe to put in the web app.
4. **Authentication → URL Configuration:**
   - *Site URL* = your final web address (e.g. `https://alumni.jecjabalpur.ac.in` or `https://jec-alumni.pages.dev`).
   - Add `https://<your-address>/**` to *Redirect URLs*.
5. **Authentication → Emails → Templates:** paste `supabase/templates/otp.html` into both **Magic Link** and **Confirm signup**. Use the subject "Your JEC Alumni Connect sign-in code".

## 2. Google sign-in

1. At console.cloud.google.com, create a project called "JEC Alumni Connect".
2. **APIs & Services → OAuth consent screen:**
   - User type: External; app name: JEC Alumni Connect; support email: the association's email.
   - Scopes: `openid`, `email`, `profile`.
   - **Publish** the app ("In production"). Testing mode limits who can sign in.
3. **Credentials → Create credentials → OAuth client ID (Web application):**
   - Authorised redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
4. In Supabase, go to **Authentication → Providers → Google**, enable it, and paste the client ID and secret.

## 3. LinkedIn sign-in

1. At linkedin.com/developers, create an app. LinkedIn requires a Company Page; use the alumni association's page or create one.
2. **Products:** add **Sign In with LinkedIn using OpenID Connect**.
3. **Auth:** add the redirect URL `https://<project-ref>.supabase.co/auth/v1/callback`.
4. In Supabase, go to **Authentication → Providers → LinkedIn (OIDC)** and paste the client ID and secret.

> LinkedIn sign-in only shares name, email and photo. Members fill the rest of their profile with **Import from LinkedIn** (profile PDF or data export) in the app.

## 4. Email sending (Brevo, 300 emails/day free)

Supabase's built-in email sends only a handful of messages an hour, so a real SMTP service is required.

1. Create a Brevo account, verify the sender address (and ideally your domain), then create an **SMTP key**.
2. In Supabase, go to **Authentication → Emails → SMTP Settings** and enable custom SMTP:
   - host `smtp-relay.brevo.com`, port `587`, and the user/key from Brevo
   - sender name "JEC Alumni Connect"
3. Under **Authentication → Rate Limits**, raise *emails per hour* (e.g. 100).

## 5. Google Drive connection (photos and CSV backups)

The app writes to **one Google account's Drive**, using the permission `drive.file`. With that permission it can only see files and folders it created itself, never the rest of the Drive. The account's email is never shown in the app.

1. In the Google Cloud project from step 2:
   - **APIs & Services → Library → Google Drive API → Enable**.
   - On the OAuth consent screen, add the scope `.../auth/drive.file`. Keep the app **In production**: refresh tokens in *Testing* mode expire after 7 days.
2. **Credentials → OAuth client ID → Web application** (a separate client named "Drive archive"):
   - Authorised redirect URI: `https://developers.google.com/oauthplayground`
3. Open developers.google.com/oauthplayground:
   - Click the gear icon, tick *Use your own OAuth credentials*, and paste the Drive archive client ID and secret.
   - In "Input your own scopes", enter `https://www.googleapis.com/auth/drive.file`, then click **Authorize APIs**.
   - Sign in with the **Drive account** (the one with 1 TB) and allow access.
   - Click **Exchange authorization code for tokens** and copy the **refresh token**.
4. Store the secrets in Supabase. Generate `BACKUP_SECRET` with e.g. `openssl rand -hex 32` and keep a copy for step 7.
   ```bash
   npx supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_DRIVE_REFRESH_TOKEN=... \
     APP_ORIGINS=https://<your-address> BACKUP_SECRET=<long-random-string>
   npx supabase functions deploy drive-upload
   npx supabase functions deploy drive-media --no-verify-jwt
   npx supabase functions deploy import-avatar
   npx supabase functions deploy nightly-backup --no-verify-jwt
   ```
5. After the first admin exists (step 8), go to **Organise → the event → Settings → Create the Drive folder**.
   - The app creates "JEC Alumni Connect - <event>" with *Then*, *Now* and *Backups* subfolders.
   - You may move this folder into your own "02 Alumni Meet 2026" folder; the app keeps working.

### 5b. Videos, glimpses and past meets (read this if you deploy the video update)

**All videos live in Drive**, none in Supabase Storage (only the small poster pictures do). A member's phone sends the video straight to Drive in 8 MB pieces with a resumable upload; the app plays it inside the page through the `drive-media` function. Limits: videos up to **500 MB** (MP4, MOV, WebM), glimpses up to **60 MB and 90 seconds**.

After pulling this update:

1. Apply the new migrations (`20261018000071_video_media.sql`, `..72_glimpses.sql`, `..73_past_meets.sql`): `npx supabase db push`.
2. **Redeploy `drive-upload`** (it now also handles videos, gallery videos, glimpses, and "use a file already in Drive") and **deploy the new `drive-media`**. `drive-media` must be deployed with `--no-verify-jwt` (already set in `supabase/config.toml`): a `<video>` tag cannot send a sign-in header, so the function checks access itself (members pass their short-lived token in the address; **glimpses are public** and need no token). No new secret is needed.
3. Videos need the event's Drive folder (**Organise, the event, Settings, Create the Drive folder**). Gallery videos and glimpses use two folders the app creates by itself on first use ("JEC Alumni Connect - College gallery videos" and "... - Glimpses").

How playback works and what it costs:

- `drive-media` checks who may see the video (the same rules as photos, enforced by row-level security), then streams the file from Drive and passes HTTP **Range** requests on, so seeking works and a phone only downloads what it plays. It serves only files named by a visible database row, never an arbitrary Drive id.
- **Bandwidth is the thing to watch.** Every second of video played passes through the function, which counts against the Supabase free plan's egress (5 GB a month) and its function invocations. Posters are tiny; videos are not. Keep glimpses short and compressed (a 20-second 720p clip is 3 to 6 MB); members' videos only download when someone presses play (`preload="metadata"`). On a busy day consider the Pro plan or moving the video proxy to a Cloudflare Worker.
- iPhone videos: Settings, Camera, Formats, **Most Compatible** gives H.264 files every device can play. HEVC `.mov` plays on Apple devices and recent Chrome but not everywhere; the upload still works, the poster is a plain card when the browser cannot read a frame.
- Glimpse playback honours **reduced motion**, **Data Saver** and slow connections (poster only, tap to play), plays one clip at a time, and pauses when off screen or the tab is hidden.

**Use files already in Drive (glimpses and gallery videos).** The admin can paste a Drive link or file id instead of uploading, so a video the committee already put in Drive is used where it is (nothing is copied or uploaded again). The app's Drive login only has the `drive.file` permission, which sees just files the app made. To let it open files you put there by hand, authorise the Drive account with **both** scopes in step 5.3: `https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly`, replace `GOOGLE_DRIVE_REFRESH_TOKEN`, and add `drive.readonly` to the OAuth consent screen. Only video files (MP4, MOV, WebM) can be attached, never other file types, and only by an admin who holds *College gallery*. Without the extra scope the admin sees "The app cannot open that file".

## 6. Hosting (Cloudflare Pages, free)

1. Create a Cloudflare account, then go to **Workers & Pages → Create → Pages → Connect to Git** and choose this repository.
2. Build settings:
   - Framework preset: none; build command: `npm run build`; output directory: `dist`.
   - Environment variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (from step 1.3), and `NODE_VERSION=22`.
3. No redirect file is needed: Pages serves `index.html` for every path of a single-page app automatically.
4. *(Optional)* **Custom domain:** a college subdomain (e.g. `alumni.jecjabalpur.ac.in`, needs a DNS CNAME from the college IT cell) or your own domain. Then update the Site URL / Redirect URLs (step 1.4), `APP_ORIGINS` (step 5.4) and the Google/LinkedIn settings if they mention the address.

## 7. Nightly backup outside Google Drive (GitHub Actions)

Every night at 02:00 IST, `.github/workflows/nightly.yml` does two things:

- It calls the backup function, which writes CSVs to Drive and keeps the free Supabase project from pausing.
- It dumps the database, compresses it and **encrypts it with AES-256**. The encrypted file is kept as a GitHub artifact for 90 days, and copied to S3-compatible storage if configured.

In the GitHub repository, go to **Settings → Secrets and variables → Actions** and add:

| Secret | Value |
|---|---|
| `SUPABASE_FUNCTIONS_URL` | `https://<project-ref>.supabase.co/functions/v1` |
| `BACKUP_SECRET` | the same random string as in step 5.4 |
| `SUPABASE_DB_URL` | Supabase → Project Settings → Database → Connection string (URI, *Session pooler*), with your DB password |
| `BACKUP_PASSPHRASE` | a long passphrase. **Write it down and give it to two committee members.** Without it, backups cannot be opened. |
| `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | *optional* third copy, e.g. Backblaze B2 (10 GB free) or Cloudflare R2 (10 GB free) |

Then open **Actions → Nightly backup and keep-alive → Run workflow** once and check that it is green. How to restore: `docs/BACKUP_RESTORE.md`.

## 8. First super admin and the event

The app is owned by **super admins** (two people is the recommended minimum). A super admin can do everything, and is the only kind
of admin who can make other admins, choose exactly what each admin may do, and hand over ownership. The full picture is in
`docs/ADMIN_ACCESS.md`.

1. Open the app and sign in with your own Google account. Complete the short profile. The second owner does the same.
2. In Supabase, go to **SQL Editor** and run this once for **each** owner, replacing the placeholder email with that person's own sign-in email:
   ```sql
   update public.profiles
      set is_admin = true, is_super_admin = true, verification = 'verified', onboarded = true
    where id = (select id from auth.users where email = 'owner@example.com');
   ```
   Nothing in the repository or a migration makes anybody a super admin: this step is the only way in the first time.
   From then on owners are managed inside the app: **Organise → Roles → Admins and owners**.
3. In the app, go to **Organise → New event**. Fill in the final details, fees and the association's UPI ID, but **leave "Published" unticked**.
4. Use **Organise → event → Team** to add treasurers and gate volunteers (check-in), and **Organise → Roles → Admins and owners → Make admin** to give committee members only the access they need. Each person must sign in once first.
5. Complete the **go-live checklist** in the Phase 1 build plan (Section 10): two people check fees and the UPI ID with a real ₹1 payment, plus a dry run with 5 committee members. Then tick **Published**.

---

## Local development

```bash
npm install
npx supabase start          # local database, auth, storage, email catcher at http://127.0.0.1:54324
cp .env.example .env.local  # paste the local URL and anon key printed by `supabase start`
npm run dev                 # http://localhost:5173
npm run check               # typecheck + lint + unit tests
npm run test:db             # database security tests (Docker)
PW_CHROMIUM=/path/to/chromium npm run test:e2e   # full journey in a phone-sized browser
```


## LinkedIn / Google profile photo

The profile photo is copied from the member's sign-in (LinkedIn or Google) by the `import-avatar` function, so it stays
available after LinkedIn's own picture link expires. LinkedIn's "Save to PDF" and data-export files do **not** contain
the photo, so sign-in is the only automatic source; members can always upload a different photo or remove it.

1. Deploy the function (see step above). It needs no extra secrets.
2. In the Supabase dashboard open **Authentication → Sign In / Providers** and switch on **Allow manual linking**.
   This lets someone who signed up by email press "Use my LinkedIn photo" in *Edit profile*, connect LinkedIn once
   and have the photo imported, without creating a second account. (Local config already has it on.)
3. Make sure the LinkedIn provider uses the "Sign In with LinkedIn using OpenID Connect" product (scopes `openid profile email`).

## Push notifications (messages, @mentions, connection requests)

Uses standard Web Push: no Firebase or other account is needed. Works on Android, desktop browsers, and on iPhone
(iOS 16.4+) once the app is added to the Home Screen.

1. Create the keys once: `node scripts/generate-push-keys.mjs`
2. Supabase → Edge Functions → Secrets: add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `PUSH_SECRET` and
   `VAPID_SUBJECT` (`mailto:` + the committee's contact address). Deploy: `npx supabase functions deploy push-send --no-verify-jwt`
3. Supabase → SQL editor, so the database knows where to send (use your project ref and the PUSH_SECRET from step 1):
   ```sql
   insert into private.settings (key, value) values
     ('push_function_url', 'https://<project-ref>.supabase.co/functions/v1/push-send'),
     ('push_secret', '<PUSH_SECRET>')
   on conflict (key) do update set value = excluded.value;
   ```
4. Hosting (Cloudflare Pages) → environment variables: `VITE_VAPID_PUBLIC_KEY` = the public key, then redeploy.

Members turn notifications on from **Notifications** (or the prompt on the Chat tab). Signing out removes the
device. Without these settings the app works exactly the same, with notifications only inside the app.
