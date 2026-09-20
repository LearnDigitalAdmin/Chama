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
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { collection, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { paths } from '../lib/firestorePaths';
import type { UserChamaMembership } from '../lib/types';

interface AuthContextValue {
  user: User | null;
  authReady: boolean;
  memberships: UserChamaMembership[];
  membershipsReady: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  authReady: false,
  memberships: [],
  membershipsReady: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [memberships, setMemberships] = useState<UserChamaMembership[]>([]);
  const [membershipsReady, setMembershipsReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
      if (!u) {
        setMemberships([]);
        setMembershipsReady(true);
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

  return (
    <AuthContext.Provider value={{ user, authReady, memberships, membershipsReady }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
