/**
 * "Create your chama" — the entry point for a brand-new admin. Requires a
 * verified email (enforced server-side by createChama; this screen just
 * gives a clear message rather than a raw error if it's rejected).
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createChama } from '../lib/callables';
import { isValidKenyanPhone } from '../lib/phone';
import { useAuth } from '../auth/AuthProvider';
import AuthLayout, { ErrorText, FormField, PrimaryButton, inputClass } from '../auth/AuthLayout';

export default function CreateChama() {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [motto, setMotto] = useState('');
  const [contributionAmount, setContributionAmount] = useState('');
  const [contributionCycle, setContributionCycle] = useState<'daily' | 'weekly' | 'monthly'>('monthly');
  const [openingBalance, setOpeningBalance] = useState('');
  const [adminName, setAdminName] = useState(user?.displayName ?? '');
  const [adminPhone, setAdminPhone] = useState('');
  const [adminIdNumber, setAdminIdNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const amount = Number(contributionAmount);
  const openingBalanceAmount = openingBalance.trim() === '' ? 0 : Number(openingBalance);
  const canSubmit =
    name.trim().length > 1 &&
    amount > 0 &&
    openingBalanceAmount >= 0 &&
    adminName.trim().length > 1 &&
    isValidKenyanPhone(adminPhone) &&
    adminIdNumber.trim().length >= 4;

  async function submit() {
    setError(null);
    if (!canSubmit) return;
    setBusy(true);
    try {
      await createChama({
        name: name.trim(),
        motto: motto.trim() || undefined,
        contributionAmount: amount,
        contributionCycle,
        openingBalance: openingBalanceAmount,
        adminName: adminName.trim(),
        adminPhone,
        adminIdNumber,
      });
      navigate('/', { replace: true });
    } catch (e) {
      const code = (e as { code?: string })?.code || '';
      if (code.includes('failed-precondition')) {
        setError('Please verify your email first — check your inbox for the verification link.');
      } else {
        setError('Something went wrong creating your chama. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Create your chama">
      <FormField label="Chama name">
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} className={inputClass} />
      </FormField>
      <FormField label="Motto (optional)">
        <input value={motto} onChange={(e) => setMotto(e.target.value)} disabled={busy} className={inputClass} />
      </FormField>
      <FormField label="Contribution amount (KES)">
        <input type="number" min={1} value={contributionAmount} onChange={(e) => setContributionAmount(e.target.value)} disabled={busy} className={inputClass} />
      </FormField>
      <FormField label="Contribution cycle">
        <select value={contributionCycle} onChange={(e) => setContributionCycle(e.target.value as typeof contributionCycle)} disabled={busy} className={inputClass}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </FormField>
      <FormField label="Opening balance (KES, optional)">
        <input type="number" min={0} placeholder="0" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} disabled={busy} className={inputClass} />
      </FormField>
      <p className="text-xs text-forest-900/50 -mt-2">
        Already have money set aside for this chama? Enter it here so your balance is accurate from day one. You can only update this later as treasurer.
      </p>

      <hr className="border-forest-100" />
      <p className="text-sm font-semibold text-ink">Your details, as chair</p>

      <FormField label="Your full name">
        <input value={adminName} onChange={(e) => setAdminName(e.target.value)} disabled={busy} className={inputClass} />
      </FormField>
      <FormField label="Your phone number">
        <input type="tel" placeholder="0712345678" value={adminPhone} onChange={(e) => setAdminPhone(e.target.value)} disabled={busy} className={inputClass} />
      </FormField>
      <FormField label="Your national ID number">
        <input value={adminIdNumber} onChange={(e) => setAdminIdNumber(e.target.value)} disabled={busy} className={inputClass} />
      </FormField>

      <PrimaryButton onClick={submit} disabled={busy || !canSubmit}>
        {busy ? 'Creating…' : 'Create chama'}
      </PrimaryButton>

      {error && <ErrorText>{error}</ErrorText>}
    </AuthLayout>
  );
}
