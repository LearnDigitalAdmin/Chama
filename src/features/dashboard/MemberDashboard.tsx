import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, doc, onSnapshot, orderBy, query, where, limit as fbLimit } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { paths } from '../../lib/firestorePaths';
import { useChama } from '../../app/ChamaProvider';
import { kes } from '../../lib/money';
import { fmtDate } from '../../lib/dates';
import { loanOutstanding } from '../../lib/loanSchedule';
import type { ChamaMember, Contribution, Loan, LoanProduct, MgrPot, Minute, SmsLogEntry } from '../../lib/types';

export default function MemberDashboard() {
  const { chama, chamaId, chamaReady, membership } = useChama();
  const [me, setMe] = useState<ChamaMember | null>(null);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [myLoan, setMyLoan] = useState<Loan | null>(null);
  const [products, setProducts] = useState<Record<string, LoanProduct>>({});
  const [myPot, setMyPot] = useState<MgrPot | null>(null);
  const [lastMinute, setLastMinute] = useState<Minute | null>(null);
  const [messages, setMessages] = useState<SmsLogEntry[]>([]);

  const memberId = membership?.memberId;

  useEffect(() => {
    if (!chamaId || !memberId) return;
    const unsubs = [
      onSnapshot(doc(db, paths.member(chamaId, memberId)), (s) => setMe(s.exists() ? ({ id: s.id, ...s.data() } as ChamaMember) : null)),
      onSnapshot(query(collection(db, paths.contributions(chamaId)), where('memberId', '==', memberId)), (s) =>
        setContributions(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Contribution))
      ),
      onSnapshot(
        query(collection(db, paths.loans(chamaId)), where('memberId', '==', memberId), where('status', 'in', ['active', 'overdue'])),
        (s) => setMyLoan(s.docs.length ? ({ id: s.docs[0].id, ...s.docs[0].data() } as Loan) : null)
      ),
      onSnapshot(collection(db, paths.loanProducts(chamaId)), (s) => {
        const map: Record<string, LoanProduct> = {};
        s.docs.forEach((d) => (map[d.id] = { id: d.id, ...d.data() } as LoanProduct));
        setProducts(map);
      }),
      onSnapshot(query(collection(db, paths.mgrPots(chamaId)), where('memberIds', 'array-contains', memberId)), (s) => {
        const all = s.docs.map((d) => ({ id: d.id, ...d.data() }) as MgrPot);
        setMyPot(all.find((p) => p.status === 'active') ?? all[0] ?? null);
      }),
      onSnapshot(query(collection(db, paths.minutes(chamaId)), orderBy('date', 'desc'), fbLimit(1)), (s) =>
        setLastMinute(s.docs.length ? ({ id: s.docs[0].id, ...s.docs[0].data() } as Minute) : null)
      ),
      onSnapshot(query(collection(db, paths.smsLog(chamaId)), orderBy('createdAt', 'desc'), fbLimit(20)), (s) =>
        setMessages(s.docs.map((d) => ({ id: d.id, ...d.data() }) as SmsLogEntry).filter((m) => m.recipientIds?.includes(memberId)))
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [chamaId, memberId]);

  if (!chamaReady || !chama || !me) return <p className="text-forest-900/60">Loading…</p>;

  const overdue = contributions.filter((c) => c.status === 'overdue');
  const pos = myPot ? myPot.queue.indexOf(memberId!) : -1;

  return (
    <div className="space-y-5">
      <div className="card p-6 bg-forest-700 border-forest-700 text-white">
        <p className="text-forest-100/70 text-sm">Total contributed to date</p>
        <p className="font-display text-3xl font-semibold mt-1">{kes(me.totalContributed)}</p>
        {overdue.length ? (
          <p className="text-gold-300 text-xs mt-3">{overdue.length} overdue cycle{overdue.length === 1 ? '' : 's'} — settle to stay in good standing.</p>
        ) : (
          <p className="text-forest-100/60 text-xs mt-3">You're fully paid up. 🎉</p>
        )}
        <Link to="/app/contributions" className="inline-block mt-4 bg-gold-400 hover:bg-gold-500 text-ink text-sm font-semibold px-4 py-2.5 rounded-full">
          Make a contribution
        </Link>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="card p-5">
          <p className="text-xs font-semibold text-forest-900/50">My loan status</p>
          {myLoan ? (
            <>
              <p className="font-display text-lg font-semibold mt-1.5">{kes(loanOutstanding(myLoan))} remaining</p>
              <p className="text-xs text-forest-900/45 mt-1">
                {products[myLoan.productId]?.name ?? 'Loan'} · <span className="chip bg-forest-50 text-forest-700">{myLoan.status}</span>
              </p>
            </>
          ) : (
            <>
              <p className="font-display text-lg font-semibold mt-1.5">No active loan</p>
              <Link to="/app/loans" className="text-xs font-semibold text-forest-700 mt-1.5 inline-block">
                Apply for one &rsaquo;
              </Link>
            </>
          )}
        </div>
        <div className="card p-5">
          <p className="text-xs font-semibold text-forest-900/50">Next meeting</p>
          <p className="font-display text-lg font-semibold mt-1.5">{lastMinute?.nextMeeting ? fmtDate(lastMinute.nextMeeting) : 'Not scheduled'}</p>
          <Link to="/app/minutes" className="text-xs font-semibold text-forest-700 mt-1.5 inline-block">
            View last minutes &rsaquo;
          </Link>
        </div>
      </div>

      {myPot && (
        <div className="card p-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs font-semibold text-forest-900/50">Merry-go-round · {myPot.name}</p>
              <p className="font-display text-lg font-semibold mt-1">
                {myPot.status === 'draft' ? 'Waiting for the draw' : pos >= 0 ? `You're #${pos + 1} in the queue` : "You've received this cycle ✓"}
              </p>
            </div>
            <Link to="/app/mgr" className="text-xs font-semibold text-forest-700 border border-forest-200 px-4 py-2 rounded-full hover:bg-forest-50 whitespace-nowrap">
              View &rsaquo;
            </Link>
          </div>
        </div>
      )}

      <div className="card p-6">
        <p className="font-display font-semibold mb-3">Latest from your chama</p>
        <div className="space-y-3">
          {messages.slice(0, 3).length ? (
            messages.slice(0, 3).map((s) => (
              <div key={s.id} className="flex items-start gap-3">
                <span>📣</span>
                <div>
                  <p className="text-sm">{s.message}</p>
                  <p className="text-xs text-forest-900/45">{new Date(s.createdAt).toLocaleString('en-KE')}</p>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-forest-900/50">No messages yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
