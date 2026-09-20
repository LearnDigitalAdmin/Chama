import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { paths } from '../lib/firestorePaths';
import type { ChamaMember } from '../lib/types';

/** Live list of a chama's members. `activeOnly` defaults to true since most
 * screens (loan applications, MGR pot creation, contribution cycles) only
 * ever care about members currently in good standing. */
export function useMembers(chamaId: string | null, activeOnly = true) {
  const [members, setMembers] = useState<ChamaMember[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!chamaId) {
      setMembers([]);
      setReady(true);
      return;
    }
    setReady(false);
    const base = collection(db, paths.members(chamaId));
    const q = activeOnly ? query(base, where('status', '==', 'active')) : base;
    const unsub = onSnapshot(
      q,
      (snap) => {
        setMembers(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ChamaMember));
        setReady(true);
      },
      () => setReady(true)
    );
    return unsub;
  }, [chamaId, activeOnly]);

  return { members, ready };
}

export function memberName(members: ChamaMember[], memberId: string): string {
  return members.find((m) => m.id === memberId)?.name ?? 'Unknown member';
}
