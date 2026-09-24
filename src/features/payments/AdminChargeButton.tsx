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
 * MGR REPAIR PASS: this used to be a single button that always charged the
 * member's own phone for a fixed amount, sight-unseen. It's now a small
 * confirm modal so the admin can:
 *   - edit the amount for a partial/top-up charge, not just the exact
 *     amount owed;
 *   - edit the phone the STK prompt goes to (defaults to the member's own
 *     phone on file — a spouse or agent paying on the member's behalf is
 *     a normal real-life case, matching the original demo's manual-entry
 *     admin charge screen). Editing it requires the extra confirmation
 *     checkbox below and is sent as `overridePhone`, never as `phone` —
 *     see functions/mychama/payments.py for why that distinction matters.
 *   - see the fee split BEFORE sending anything, labelled the way the
 *     demo labelled it: "Transaction Cost" (Paystack's cut) and
 *     "MyChama Fee" (this app's markup) — both computed with the same
 *     grossUpForFees() the backend uses, so the number on screen matches
 *     what actually gets charged.
 */

import { useMemo, useState } from 'react';
import { useChama } from '../../app/ChamaProvider';
import { PLANS } from '../../lib/constants';
import { initiatePayment } from '../../lib/callables';
import { describeCallError } from '../../lib/errorMessages';
import { contributionFees, mgrContributionFees, kes } from '../../lib/money';
import { Spinner } from '../../components/Spinner';

type AdminChargePurpose = 'contribution' | 'mgr_contribution';

export function AdminChargeButton({
  chamaId,
  memberId,
  memberPhone,
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
  /** Member's phone on file, shown as the modal's default — pass it through so we don't need an extra read. */
  memberPhone?: string;
  /** Net amount the member owes for this purpose — same figure "Record cash" would take. Editable in the modal. */
  amount: number;
  purpose: AdminChargePurpose;
  contributionId?: string;
  potId?: string;
  potPeriod?: number;
  label?: string;
  onCharged?: (result: { reference: string }) => void;
}) {
  const { chama } = useChama();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queuedMsg, setQueuedMsg] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const [editAmount, setEditAmount] = useState(amount);
  const [editPhone, setEditPhone] = useState(memberPhone ?? '');
  const [confirmOverride, setConfirmOverride] = useState(false);

  const phoneChanged = editPhone.trim() !== '' && editPhone.trim() !== (memberPhone ?? '').trim();

  const fees = useMemo(() => {
    const calc = purpose === 'mgr_contribution' ? mgrContributionFees : contributionFees;
    return editAmount > 0 ? calc(editAmount) : null;
  }, [editAmount, purpose]);

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

  function openModal() {
    setEditAmount(amount);
    setEditPhone(memberPhone ?? '');
    setConfirmOverride(false);
    setError(null);
    setOpen(true);
  }

  async function charge() {
    if (!(editAmount > 0)) return setError('Enter an amount greater than zero.');
    if (phoneChanged && !confirmOverride) {
      return setError('Confirm below that this number belongs to someone paying on the member\'s behalf.');
    }
    setError(null);
    setBusy(true);
    try {
      const res = await initiatePayment({
        chamaId,
        purpose,
        amount: editAmount,
        memberId,
        overridePhone: phoneChanged ? editPhone.trim() : undefined,
        contributionId,
        potId,
        potPeriod,
      });
      setSent(true);
      setOpen(false);
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
        onClick={openModal}
        disabled={!(amount > 0)}
        className="border border-forest-200 hover:bg-forest-50 text-xs font-semibold px-3 py-1.5 rounded-full disabled:opacity-50"
      >
        {label}
      </button>
      {queuedMsg && <p className="text-xs text-gold-700 font-medium">{queuedMsg}</p>}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-forest-900">Charge via Paystack</h3>

            <label className="text-xs font-medium text-forest-900/70">
              Amount
              <input
                type="number"
                min={1}
                value={editAmount}
                onChange={(e) => setEditAmount(Number(e.target.value))}
                disabled={busy}
                className="mt-1 w-full border border-forest-200 rounded-lg px-3 py-2 text-sm"
              />
            </label>

            <label className="text-xs font-medium text-forest-900/70">
              Phone to send the STK prompt to
              <input
                type="tel"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                disabled={busy}
                placeholder={memberPhone || "Leave blank to use the member's phone on file"}
                className="mt-1 w-full border border-forest-200 rounded-lg px-3 py-2 text-sm"
              />
            </label>

            {phoneChanged && (
              <label className="flex items-start gap-2 text-xs text-gold-700 bg-gold-50 rounded-lg p-2">
                <input
                  type="checkbox"
                  checked={confirmOverride}
                  onChange={(e) => setConfirmOverride(e.target.checked)}
                  disabled={busy}
                  className="mt-0.5"
                />
                <span>This isn't the member's own number on file. I've confirmed with whoever's paying that they've agreed to pay on the member's behalf.</span>
              </label>
            )}

            {fees && (
              <div className="text-xs bg-forest-50 rounded-lg p-3 flex flex-col gap-1">
                <div className="flex justify-between"><span className="text-forest-900/60">Member pays</span><span className="font-semibold">{kes(fees.gross)}</span></div>
                <div className="flex justify-between text-forest-900/60"><span>Transaction Cost</span><span>{kes(fees.paystackFee)}</span></div>
                <div className="flex justify-between text-forest-900/60"><span>MyChama Fee</span><span>{kes(fees.ourFee)}</span></div>
                <div className="flex justify-between border-t border-forest-100 pt-1 font-medium"><span>Chama receives</span><span>{kes(fees.net)}</span></div>
              </div>
            )}

            {error && <p className="text-xs text-brick-500 font-medium">{error}</p>}

            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setOpen(false)} disabled={busy} className="text-xs font-semibold px-3 py-1.5 rounded-full text-forest-900/60 hover:bg-forest-50 disabled:opacity-50">
                Cancel
              </button>
              <button
                onClick={charge}
                disabled={busy || !(editAmount > 0)}
                className="btn-primary text-xs font-semibold px-4 py-1.5 rounded-full disabled:opacity-50 flex items-center gap-2"
              >
                {busy && <Spinner />}
                {busy ? 'Sending…' : 'Send STK prompt'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
