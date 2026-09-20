/**
 * Resolves which chama the signed-in user is currently working in.
 *
 * Phase 1 already gives us `memberships` (live) via AuthProvider. Most
 * people belong to exactly one chama, so this defaults to the first one
 * and exposes a switcher for the rare multi-chama case. Every feature
 * screen reads `chamaId` and `membership.role` from here rather than
 * re-deriving them, so a chama switch propagates everywhere at once.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { paths } from '../lib/firestorePaths';
import type { Chama, UserChamaMembership } from '../lib/types';
import { useAuth } from '../auth/AuthProvider';

interface ChamaContextValue {
  chamaId: string | null;
  membership: UserChamaMembership | null;
  chama: Chama | null;
  chamaReady: boolean;
  memberships: UserChamaMembership[];
  setChamaId: (id: string) => void;
  isFinanceAdmin: boolean;
  isOfficial: boolean;
}

const ChamaContext = createContext<ChamaContextValue>({
  chamaId: null,
  membership: null,
  chama: null,
  chamaReady: false,
  memberships: [],
  setChamaId: () => {},
  isFinanceAdmin: false,
  isOfficial: false,
});

export function ChamaProvider({ children }: { children: ReactNode }) {
  const { memberships, membershipsReady } = useAuth();
  const [selected, setSelected] = useState<string | null>(null);
  const [chama, setChama] = useState<Chama | null>(null);
  const [chamaReady, setChamaReady] = useState(false);

  useEffect(() => {
    if (!membershipsReady) return;
    if (selected && memberships.some((m) => m.chamaId === selected)) return;
    setSelected(memberships[0]?.chamaId ?? null);
  }, [membershipsReady, memberships, selected]);

  useEffect(() => {
    if (!selected) {
      setChama(null);
      setChamaReady(true);
      return;
    }
    setChamaReady(false);
    const unsub = onSnapshot(
      doc(db, paths.chama(selected)),
      (snap) => {
        setChama(snap.exists() ? ({ id: snap.id, ...snap.data() } as Chama) : null);
        setChamaReady(true);
      },
      () => setChamaReady(true)
    );
    return unsub;
  }, [selected]);

  const membership = memberships.find((m) => m.chamaId === selected) ?? null;

  const value = useMemo<ChamaContextValue>(
    () => ({
      chamaId: selected,
      membership,
      chama,
      chamaReady,
      memberships,
      setChamaId: setSelected,
      isFinanceAdmin: membership?.role === 'chair' || membership?.role === 'treasurer',
      isOfficial: membership?.role === 'chair' || membership?.role === 'treasurer' || membership?.role === 'secretary',
    }),
    [selected, membership, chama, chamaReady, memberships]
  );

  return <ChamaContext.Provider value={value}>{children}</ChamaContext.Provider>;
}

export function useChama() {
  return useContext(ChamaContext);
}
