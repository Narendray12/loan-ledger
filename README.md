# DevKripa

Mobile-first PWA for a money lender. The admin types the paper **ऋण आवेदन पत्र / Loan Application Form** into the app, verifies the borrower's mobile by calling it in front of them, photographs the person, their ID and the signed form, and then tracks every loan as **monthly cards** (paid / unpaid, mark paid, undo).

Works offline: everything is saved on the phone first (encrypted IndexedDB) and synced to Supabase when there is internet. See [PLAN.md](PLAN.md) for the design.

## Stack

- React 19 + TypeScript + Vite, Tailwind, `vite-plugin-pwa`
- Dexie (IndexedDB) mirror + outbox, AES-GCM at rest, `src/lib/sync.ts`
- Supabase (Postgres + RLS + Storage) as the source of truth, Mumbai region

## 1. One-time setup

### Supabase (database, storage, admin login)

1. Create a project at supabase.com (region **South Asia (Mumbai)**).
2. In the project: **Authentication → Providers → Email**, turn **off** "Allow new users to sign up". Keep Email enabled.
3. **Authentication → URL Configuration**: set **Site URL** to where the app will be hosted (used by password-reset links).
4. Apply the schema. Put the database connection string (**Connect → Direct connection**) in `.env` as `SUPABASE_DB_URL`, then:
   ```bash
   npm run db:push
   ```
5. Create your admin login. `auth.users` is not in the public schema, so it is not in the Table Editor; use **Authentication → Users → Add user** (the lock icon in the left sidebar) with _Auto confirm_ ticked, or run:
   ```bash
   npm run admin:create
   ```
   It prompts for email, name and password, creates the confirmed user, adds it to `admins`, and test-signs-in. **The first user created becomes the admin automatically.** Later admins are added from the app's Settings screen.
6. **Settings → API**: copy the Project URL and the anon key into `.env` (see `.env.example`).

### Phone verification

There is no SMS OTP and nothing to configure. The admin taps **Verify** on a borrower's number, calls
it from the app while the borrower is present, sees their phone ring, and marks it verified. The
verification is stored with the number and shows as a badge wherever that number appears.

### Environment

```bash
cp .env.example .env   # then fill in the values
```

## 2. Run

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # unit tests (validators, cards, sync engine)
npm run lint           # eslint + prettier
npm run build          # production build in dist/ (includes the service worker)
```

Deploy `dist/` to any static host. For Cloudflare Pages the `public/_redirects` file already routes every path to `index.html`. On the phone, open the URL in Chrome and choose **Add to Home screen**; the app then launches full-screen and works offline.

### Developing without a backend

Create `.env.local` with `VITE_DEV_BYPASS_AUTH=1` (plus any values for the Supabase vars) to open every screen with a fake session. Data stays in the browser; sync shows as failed. This flag is ignored in production builds.

### Local Supabase (needs Docker)

```bash
npx supabase start     # applies supabase/migrations and supabase/seed.sql
```

The seed creates `admin@example.com` / `password123` as the admin. Use the printed API URL and anon key in `.env`.

## 3. How it works

| Piece          | Where                                                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Screens        | `src/screens/` — People (home), NewApplication (the paper form), PersonDetail/Edit, LoanDetail/Edit, Settings, Login                                            |
| Validation     | `src/lib/schemas.ts` (zod), `src/lib/validators.ts` (Aadhaar Verhoeff, PAN, Voter ID, DL, phone)                                                                |
| Monthly cards  | `src/lib/cards.ts` — one card per month; the last card absorbs any difference so cards add up to the paper's total                                              |
| Local database | `src/lib/db.ts` (Dexie) — mirror of the server tables plus `drafts`, `outbox`, `blobs`                                                                          |
| Sync           | `src/lib/sync.ts` — push the outbox FIFO, then pull rows changed since the last pull; newer local edits win                                                     |
| Photos         | `src/lib/docs.ts`, `src/lib/image.ts` — resize to ≤1600 px JPEG, strip EXIF, encrypt locally, upload, keep a thumbnail                                          |
| Verification   | `src/components/VerifyPhoneSheet.tsx` — call the number in front of the borrower, mark it verified                                                              |
| Database       | `supabase/migrations/20260905000000_init.sql` — tables, RLS (`is_admin()`), encrypted ID numbers (`upsert_person`, `reveal_id`), audit log, loan status trigger |

Security notes: only users in `public.admins` can read or write anything (RLS); ID numbers are stored encrypted in a table the client role cannot read and are revealed only through an audited function; local drafts, queued changes and photos are AES-GCM encrypted with a per-device key; signing out wipes the phone.

## Deploy (GitHub Pages)

Every push to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml): tests, a
build with `BASE_PATH=/<repo>/`, and a Pages deployment. The build reads its settings from
repository secrets named exactly like the `VITE_*` keys in `.env.example`
(`gh secret set VITE_SUPABASE_URL --body "..."`). After the first deploy:

- Supabase → Authentication → URL configuration: add the Pages URL as Site URL / redirect URL
  so password-reset links open the app.

## Design

The screens follow the passbook design canvas in `design/` (ledger paper and ink; green means
paid, red means late). A person can hold several ID proofs, each with its own front and back
photo; the number itself is stored encrypted server-side and only the last 4 digits reach the
phone. The application form is a six-step wizard, one step per section of the paper form.
