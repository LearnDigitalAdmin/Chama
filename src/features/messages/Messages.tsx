import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query, limit as fbLimit } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { paths } from '../../lib/firestorePaths';
import { useChama } from '../../app/ChamaProvider';
import type { SmsLogEntry } from '../../lib/types';

const AUDIENCE_LABEL: Record<string, string> = {
  all: 'To everyone',
  overdue: 'To overdue contributors',
  custom: 'To selected members',
};

/**
 * Every message a campaign addressed to this member — see
 * functions/mychama/sms.py's recipientIds addition (TOUCH_BASE.md). This
 * doubles as a fallback: if the SMS itself never arrived, the member still
 * sees it here.
 */
export default function Messages() {
  const { chamaId, chamaReady, membership } = useChama();
  const [messages, setMessages] = useState<SmsLogEntry[]>([]);
  const memberId = membership?.memberId;

  useEffect(() => {
    if (!chamaId || !memberId) return;
    return onSnapshot(query(collection(db, paths.smsLog(chamaId)), orderBy('createdAt', 'desc'), fbLimit(100)), (s) => {
      setMessages(s.docs.map((d) => ({ id: d.id, ...d.data() }) as SmsLogEntry).filter((m) => m.recipientIds?.includes(memberId)));
    });
  }, [chamaId, memberId]);

  if (!chamaReady) return <p className="text-forest-900/60">Loading…</p>;

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="font-display text-2xl font-semibold text-ink">Messages</h1>
      {messages.length ? (
        <ul className="space-y-3">
          {messages.map((m) => (
            <li key={m.id} className="card p-4">
              <p className="text-sm text-ink">{m.message}</p>
              <div className="flex items-center justify-between mt-2">
                <span className="chip bg-forest-50 text-forest-900/50">{AUDIENCE_LABEL[m.audience] ?? m.audience}</span>
                <span className="text-xs text-forest-900/40">{new Date(m.createdAt).toLocaleString('en-KE')}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-forest-900/50">No messages yet — announcements from your chama will show up here.</p>
      )}
    </div>
  );
}
