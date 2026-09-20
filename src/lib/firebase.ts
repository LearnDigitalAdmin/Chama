/**
 * Firebase app initialisation — SINGLE place the app creates its Firebase
 * App/Auth/Firestore instances. Every screen imports `auth`, `db`, `functions`
 * from here rather than calling initializeApp() again.
 *
 * OFFLINE SUPPORT (see docs/OFFLINE.md for the full design):
 * Firestore is initialised with `persistentLocalCache` + multi-tab manager.
 * This is what makes direct-write screens (loan application/approval, loan
 * products, minutes — see docs/API_CONTRACT.md's Phase 2 note on which
 * operations are direct writes) work completely offline: reads come from
 * the local cache instantly, writes queue locally and the SDK replays them
 * the moment connectivity returns, with no code of ours involved. Callable
 * Cloud Functions (money-critical operations) are NOT covered by this —
 * they need a live HTTPS round trip — so those go through
 * src/lib/offlineQueue.ts instead, which gives them the same
 * queue-while-offline, sync-on-reconnect behaviour deliberately, rather
 * than just failing.
 *
 * Auth persistence: set to `browserLocalPersistence` so a returning member
 * or admin does NOT need to re-verify (no repeat phone OTP, no repeat
 * Google popup, no repeat email/password) until they explicitly sign out or
 * clear site data. This is what keeps phone-auth (billed per OTP) cheap —
 * see docs/ARCHITECTURE.md "Auth session persistence & cost control".
 *
 * Money-moving actions still re-check the caller's role server-side on
 * every callable (see functions/shared/roles.py) — persistence only avoids
 * re-authenticating the *session*, it never substitutes for authorisation.
 */

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  browserLocalPersistence,
  setPersistence,
  GoogleAuthProvider,
  type Auth,
} from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { getFunctions, type Functions } from 'firebase/functions';

const firebaseConfig = {
  apiKey: "AIzaSyDX4hDBp_N4I5K1jyjI1T_FgocvkeauIf8",
  authDomain: "mychama1.firebaseapp.com",
  projectId: "mychama1",
  storageBucket: "mychama1.firebasestorage.app",
  messagingSenderId: "230753021589",
  appId: "1:230753021589:web:6aff092e21ba736845f59c",
  measurementId: "G-LMGTLVP1VZ"
};

export const app: FirebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth: Auth = getAuth(app);
// Fire-and-forget: persistence must be set before any sign-in call resolves,
// but does not need to block app boot.
void setPersistence(auth, browserLocalPersistence);

// persistentMultipleTabManager lets the member/admin have MyChama open in
// more than one tab (common on a desktop treasurer's machine) without the
// second tab silently losing offline capability.
export const db: Firestore = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// Region MUST match wherever the mychama1 functions are deployed
// (see functions/main.py — keep these in sync).
export const functions: Functions = getFunctions(app, 'africa-south1' /* or your deployed region */);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

/**
 * Recaptcha container ID the phone-auth screen must render an invisible
 * <div id={RECAPTCHA_CONTAINER_ID} /> for, before calling
 * signInWithPhoneNumber. Kept as a constant so it's identical everywhere
 * it's referenced.
 */
export const RECAPTCHA_CONTAINER_ID = 'mychama-recaptcha-container';
