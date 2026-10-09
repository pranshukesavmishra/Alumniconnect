# Backups and how to restore

## Where the data is kept

| Copy | What | Where | How long |
|---|---|---|---|
| Live | Everything | Supabase | — |
| 1 | Registrations, payments, tickets (CSV) | Committee Google Drive → `Backups` | until deleted |
| 2 | Whole database, compressed and encrypted (AES-256) | GitHub Actions artifact | 90 days, nightly |
| 3 | Same encrypted file *(optional)* | Cloudflare R2 / Backblaze B2 bucket | your bucket's rules |
| Photos | Full-quality originals | Committee Google Drive → `Then` / `Now` | until deleted |

The encrypted backups contain all app data, sign-in accounts and photo records. They do **not** contain passwords (there are none) or the photo files themselves: originals live in Drive, and the app's compressed copies live in Supabase Storage. The decryption passphrase is the `BACKUP_PASSPHRASE` secret, which two committee members must keep somewhere other than Drive and GitHub.

## Restore into a new Supabase project

This procedure was rehearsed on 9 Oct 2026 against a real Supabase stack (backup, wipe, restore): all 34 tables, including chat history, sign-in accounts and file records, came back with identical row counts.

1. **Download a backup:** GitHub → Actions → *Nightly backup and keep-alive* → a recent run → Artifacts. Or take it from the R2/B2 bucket.
2. **Decrypt it:**
   ```bash
   gpg --decrypt --output data.dump jec-alumni-db-YYYY-MM-DD_HHMM.dump.gpg   # asks for the passphrase
   ```
3. **Create a new Supabase project**, then create the app's tables from this repository:
   ```bash
   npx supabase link --project-ref <new-ref>
   npx supabase db push
   ```
4. **Load the data.** Replica mode stops triggers from running twice. Use the *Session pooler* connection string from Project Settings → Database:
   ```bash
   pg_restore --data-only --no-owner -f data.sql data.dump
   ( echo 'SET session_replication_role = replica;'; cat data.sql ) | psql "<connection string>" -v ON_ERROR_STOP=1
   ```
5. **Re-do the configuration** in docs/SETUP.md, steps 1.3–1.5 and 2–7 (providers, SMTP, secrets, functions, hosting variables). Members sign in exactly as before; their accounts, profiles, registrations and payments are all there.
6. **Photo files:** compressed copies in the old project's Storage are not in the database backup. If the old project is still reachable, copy the `avatars` and `event-photos` buckets across. Otherwise the originals are in Drive and can be re-uploaded.

## Check the backups monthly

- GitHub → Actions: the nightly job should be green every day.
- Decrypt the latest backup once (step 2) to confirm the passphrase still works.
