# MyChama — Phase 1 Prompt: Identity & Access Foundation

Paste this into a fresh chat, attach the demo file `MyChama_3_1.html`, and
attach/connect the **Chama** repo (`https://github.com/LearnDigitalAdmin/Chama`)
— make sure `functions/shared/`, `src/lib/`, and `docs/` from the global
files package have already been committed and pushed before starting.

---

I'm building the live version of MyChama, a chama (savings group) management
app, on Firebase project `mychama1`. Cloud Functions are Python; the
frontend is in `src/` (Vite + React/TS, currently unbuilt boilerplate). The
attached HTML file is the complete UI/UX demo (localStorage-backed) that
defines every screen and feature — treat it as the design and feature
source of truth, but its data layer will be replaced with real Firebase.

Before writing any code, read in this order:
1. `docs/ARCHITECTURE.md` — system design, the auth model (§3), and the
   invite/claim flow (§3) in particular.
2. `docs/CONVENTIONS.md` — naming, money/date formats, and the rule that
   you import from `functions/shared/` and `src/lib/` rather than
   redefining anything.
3. `docs/API_CONTRACT.md` — Phase 1 section only for now.
4. `firestore.rules` and `firestore.indexes.json` at the repo root — the
   already-finalised security model these callables must not contradict.

**This phase's scope — identity and access only, no money movement:**

1. Firebase Auth, three seamless methods, properly connected:
   - Phone (primary for members): `signInWithPhoneNumber` + invisible
     reCAPTCHA (container ID is `RECAPTCHA_CONTAINER_ID` from
     `src/lib/firebase.ts`).
   - Google (secondary for everyone): after first sign-in, must collect
     the phone number and ID number the schema requires before the account
     is usable — see `completeProfile` in `docs/API_CONTRACT.md`.
   - Email + password (primary for admins): with `sendEmailVerification`;
     `createChama` must reject an unverified email server-side.
   - Session persistence: `src/lib/firebase.ts` already sets
     `browserLocalPersistence` — use the exported `auth` instance as-is,
     don't re-initialise.

2. Python callables (exact names/shapes from `docs/API_CONTRACT.md`):
   `createChama`, `addAdmin`, `addMember`, `claimInvite`,
   `completeProfile`, `updateMember`.

3. A Firestore trigger (`on_member_write` or similar) that keeps
   `userChamas/{uid}/memberships/{chamaId}` in sync with the `members`
   subcollection — every role check everywhere else in the system reads
   this index, so it must be exactly right.

4. Deploy and manually verify `firestore.rules` / `firestore.indexes.json`
   against real signed-in users (not just the Firestore emulator's default
   permissive mode).

5. Minimal frontend to exercise all of the above end-to-end: sign-up/sign-in
   screens for all three methods, a "create your chama" flow for a new
   admin, an "I was invited" claim flow, and role-based routing into the
   demo's existing `NAV`/`BOTTOM_NAV` structure (see the demo's `const NAV`
   definitions) — just enough shell to prove auth + membership resolution
   works. Full feature screens are later phases.

**Out of scope for this phase:** contributions, loans, MGR, payments, SMS,
billing — anything that isn't creating a chama, adding people to it, and
proving they can sign in and are recognised with the right role.

When you're done, update `docs/IMPLEMENTATION_PLAN.md`'s Phase 1 checklist
in your commit, and flag in your summary any field, collection, or
convention you had to add that isn't already in `functions/shared/` or
`src/lib/`, so it can be back-ported into the global package before Phase 2
starts.
