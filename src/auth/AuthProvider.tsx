/**
 * AuthProvider — the single source of truth for "who is signed in and what
 * chamas/roles do they have" across the app.
 *
 * Two pieces of state are tracked separately on purpose:
 *   - `user`: the Firebase Auth user (or null). Cheap, synchronous-ish via
 *     onAuthStateChanged.
 *   - `memberships`: a live listener on userChamas/{uid}/memberships — the
 *     SAME index firestore.rules and every Python callable's role checks
 *     read (see docs/ARCHITECTURE.md §3, functions/shared/roles.py). The
 *     app never infers role from a members doc directly.
 *
 * `authReady` / `membershipsReady` are separate so screens can render a
 * "signed in, loading your chamas..." state instead of a flash of the
 * wrong screen.
 *
 * `claimingInvites` covers a third, short-lived state: right after a
 * phone sign-in resolves with zero memberships, this provider calls
 * claimMyInvites() once (see src/lib/callables.ts) to auto-attach the
 * caller to any pending member record an admin already created for their
 * phone number — no invite link required. Home.tsx uses this flag to show
 * "checking for invites…" instead of immediately telling a freshly-added
 * member they're not part of any chama.
 */

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { collection, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { paths } from '../lib/firestorePaths';
import { claimMyInvites } from '../lib/callables';
import type { UserChamaMembership } from '../lib/types';

interface AuthContextValue {
  user: User | null;
  authReady: boolean;
  memberships: UserChamaMembership[];
  membershipsReady: boolean;
  claimingInvites: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  authReady: false,
  memberships: [],
  membershipsReady: false,
  claimingInvites: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [memberships, setMemberships] = useState<UserChamaMembership[]>([]);
  const [membershipsReady, setMembershipsReady] = useState(false);
  const [claimingInvites, setClaimingInvites] = useState(false);
  const claimAttemptedForUid = useRef<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
      if (!u) {
        setMemberships([]);
        setMembershipsReady(true);
        claimAttemptedForUid.current = null;
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) return;
    setMembershipsReady(false);
    const unsub = onSnapshot(
      collection(db, paths.userChamaMemberships(user.uid)),
      (snap) => {
        setMemberships(snap.docs.map((d) => d.data() as UserChamaMembership));
        setMembershipsReady(true);
      },
      () => setMembershipsReady(true)
    );
    return unsub;
  }, [user]);

  // Phone-authenticated user, memberships loaded and empty, not yet tried
  // this session — attempt to auto-claim any pending invite for their
  // phone number. If claimMyInvites finds and attaches a member record,
  // the userChamas listener above picks up the new membership live, so
  // there's nothing to merge manually here.
  useEffect(() => {
    if (!user || !user.phoneNumber) return;
    if (!membershipsReady || memberships.length > 0) return;
    if (claimAttemptedForUid.current === user.uid) return;
    claimAttemptedForUid.current = user.uid;

    setClaimingInvites(true);
    claimMyInvites({})
      .catch(() => {
        // Best-effort: if this fails (e.g. offline), the user still sees
        // the normal "no chama yet" screen rather than getting stuck.
      })
      .finally(() => setClaimingInvites(false));
  }, [user, membershipsReady, memberships.length]);

  return (
    <AuthContext.Provider value={{ user, authReady, memberships, membershipsReady, claimingInvites }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
