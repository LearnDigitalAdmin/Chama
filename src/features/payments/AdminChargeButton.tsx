/**
 * Shared "Charge Paystack" action for a finance admin collecting on a
 * member's behalf. One component, one backend path
 * (initiatePayment({ memberId, ... }) — see functions/mychama/payments.py),
 * so any purpose already in that callable's dispatch table plugs in here
 * by passing a different `purpose` + matching id fields, no new backend
 * work required. Used today by:
 *   - src/features/contributions/Contributions.tsx  (purpose: 'contribution')
 *   - src/features/mgr/MgrPotDetail.tsx              (purpose: 'mgr_contribution')
 *
 * The phone charged always comes from the member's own record, resolved
 * server-side — this component never collects or sends a phone number.
 */

import { useState } from 'react';
import { useChama } from '../../app/ChamaProvider';
import { PLANS } from '../../lib/constants';
import { initiatePayment } from '../../lib/callables';
import { describeCallError } from '../../lib/errorMessages';

type AdminChargePurpose = 'contribution' | 'mgr_contribution';

export function AdminChargeButton({
  chamaId,
  memberId,
  amount,
  purpose,
  contributionId,
  potId,
  potPeriod,
  label = 'Charge Paystack',
  onCharged,
}: {
  chamaId: string;
  memberId: string;
  /** Net amount the member owes for this purpose — same figure "Record cash" would take. */
  amount: number;
  purpose: AdminChargePurpose;
  contributionId?: string;
  potId?: string;
  potPeriod?: number;
  label?: string;
  onCharged?: (result: { reference: string }) => void;
}) {
  const { chama } = useChama();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queuedMsg, setQueuedMsg] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const planAllowsOnline = chama ? PLANS[chama.plan].onlineCollection : false;
  const hasSettlement = !!chama?.settlementSplitCode;

  if (!planAllowsOnline) {
    return (
      <p className="text-xs text-forest-900/50">
        {chama?.plan === 'free' ? "Paystack needs a paid plan — record cash, or upgrade to collect online." : "Paystack isn't available on this plan."}
      </p>
    );
  }
  if (!hasSettlement) {
    return <p className="text-xs text-forest-900/50">Ask the chair to set up a settlement account (in Payments) to collect via Paystack.</p>;
  }
  if (sent) {
    return <span className="text-xs text-forest-700 font-medium">STK prompt sent — waiting for confirmation</span>;
  }

  async function charge() {
    if (!(amount > 0)) return;
    setError(null);
    setBusy(true);
    try {
      const res = await initiatePayment({ chamaId, purpose, amount, memberId, contributionId, potId, potPeriod });
      setSent(true);
      onCharged?.(res);
    } catch (e) {
      const { message, isQueued } = describeCallError(e);
      if (isQueued) {
        // A live Paystack call can't be meaningfully queued offline — if
        // this happens, describeCallError is telling us the SDK queued the
        // write anyway; surface it but don't claim an STK prompt went out.
        setQueuedMsg(message);
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={charge}
        disabled={busy || !(amount > 0)}
        className="border border-forest-200 hover:bg-forest-50 text-xs font-semibold px-3 py-1.5 rounded-full disabled:opacity-50"
      >
        {busy ? 'Sending…' : label}
      </button>
      {error && <p className="text-xs text-brick-500 font-medium">{error}</p>}
      {queuedMsg && <p className="text-xs text-gold-700 font-medium">{queuedMsg}</p>}
    </div>
  );
}
