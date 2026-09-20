# MyChama — Phase 1 Delivery (Identity & Access)

I don't have push access to `LearnDigitalAdmin/Chama`, so everything below
is built, compiled, and verified in a local clone but needs to be copied
into your real checkout and committed by you. Every file here is a full
replacement or brand-new file — copy the whole tree over your repo root.

## Apply it

```bash
git clone https://github.com/LearnDigitalAdmin/Chama.git
cd Chama
# copy every file from this delivery over the repo root, preserving paths
cp -r /path/to/phase1-delivery/. .
npm install
cd functions && pip install -r requirements.txt --break-system-packages && cd ..
cp .env.example .env.local   # fill in your real Firebase web config
git add -A
git commit -m "Phase 1: identity & access — auth (phone/Google/email), createChama/addAdmin/addMember/claimInvite/completeProfile/updateMember, userChamas sync trigger"
git push
```

Then in the Firebase console / CLI:
- Enable Phone, Google, and Email/Password sign-in providers for the
  `mychama1` Auth instance (Email/Password already appears configured per
  `firebase.json`; Phone needs enabling and, for production, a reCAPTCHA
  Enterprise key or the legacy reCAPTCHA v2 flow this code uses).
- `firebase deploy --only firestore:rules,firestore:indexes,functions`

## What's verified, and how

- **Python** (`functions/`): every file parses (`ast.parse`), and — more
  importantly — `main.py` was actually imported end-to-end with the real
  `firebase_functions`/`firebase_admin` packages installed in a clean
  venv. All 6 callables (`createChama`, `addAdmin`, `addMember`,
  `claimInvite`, `completeProfile`, `updateMember`) and the
  `on_member_write` trigger register without error. Phone normalisation
  and ID-masking helpers were also exercised directly with real inputs
  (Safaricom and Airtel prefixes, three phone spellings) and produce
  correct, consistent output.
- **TypeScript/React** (`src/`): `tsc -b --noEmit` passes clean, and a full
  `vite build` production build succeeds. I want to flag one thing I found
  and fixed rather than leave silent: **your repo's existing `index.html`
  had no `<div id="root">` or script tag pointing at `src/main.tsx`** — it
  was still the old marketing/demo page, so a React app could sit in `src/`
  indefinitely and Vite would build it into nothing. I replaced
  `index.html` with a minimal proper Vite entry point (kept the title/meta/
  favicon); after that fix the build went from 3 modules transformed to 58,
  and `dist/index.html` correctly references the built bundle. Your
  marketing/landing page content is not lost — it's in the git history of
  the old `index.html` — but it needs a deliberate decision on where it
  lives now (a separate static page? a route in this app?) rather than
  silently being the thing `npm run dev` shows.
- **Not verified here** (needs your actual Firebase project): live
  reCAPTCHA + phone OTP delivery, real Google OAuth consent screen, actual
  Firestore reads/writes against a real project, and the deployed Cloud
  Functions themselves. `initialize_app()` succeeds locally with no
  credentials because it doesn't contact GCP until a Firestore call is
  actually made — that first real call only happens at deploy + invocation.

## What this covers, mapped to docs/API_CONTRACT.md

| Callable | File |
|---|---|
| `createChama` | `functions/mychama/identity.py` |
| `addAdmin`, `addMember` | `functions/mychama/identity.py` (shared `_add_person`) |
| `claimInvite` | `functions/mychama/identity.py` |
| `completeProfile` | `functions/mychama/identity.py` |
| `updateMember` | `functions/mychama/identity.py` |
| `on_member_write` trigger | `functions/mychama/triggers.py` |

Frontend: `src/auth/` (phone/Google/email sign-in, complete-profile),
`src/onboarding/` (create-chama, claim-invite), `src/lib/firebase.ts`
(session persistence already configured), `src/App.tsx` (routing).

## Two design decisions I made that you should confirm

1. **`claimInvite` requires the caller's Firebase Auth phone number to
   match the invite's phone exactly** (checked server-side via
   `req.auth.token['phone_number']`). This is airtight for members who
   sign in by phone, but means someone invited by phone who wants to use
   Google/email instead must first *link* a phone credential to their
   account before claiming — I didn't build that linking UI in this phase
   (it's a `linkWithCredential` call to add, not a new callable). Flag if
   you'd rather relax this.
2. **`updateMember`'s chair-role protection**: I blocked changing the
   current chair's role through this callable entirely (raises
   `permission-denied` with a message pointing at "a dedicated
   chair-transfer flow, not implemented in Phase 1") rather than allowing
   an accidental or malicious demotion of the only chair. A proper
   handover flow (old chair confirms + new chair accepts) is a reasonable
   Phase 2 addition.
