/**
 * Shown right after a first-time Google sign-in. Collects the phone number
 * and ID number the schema requires and calls the completeProfile
 * callable, which also claims any pending member record that phone number
 * matches (see functions/mychama/identity.py::completeProfile and
 * docs/ARCHITECTURE.md §3).
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { completeProfile } from '../lib/callables';
import { isValidKenyanPhone } from '../lib/phone';
import AuthLayout, { ErrorText, FormField, PrimaryButton, inputClass } from './AuthLayout';

export default function CompleteProfile() {
  const [phone, setPhone] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function submit() {
    setError(null);
    if (!isValidKenyanPhone(phone)) {
      setError('Enter a valid Kenyan phone number, e.g. 0712345678.');
      return;
    }
    setBusy(true);
    try {
      const res = await completeProfile({ phone, idNumber: idNumber || undefined });
      if (res.memberId) {
        navigate('/', { replace: true });
      } else {
        setError("We couldn't find a pending invite for that number. Ask your chama admin to add you first.");
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Just a couple more details" subtitle="Your chama admin added you using your phone number — enter it below to link your account.">
      <FormField label="Phone number">
        <input type="tel" placeholder="0712345678" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} className={inputClass} />
      </FormField>
      <FormField label="National ID number (optional here — a finance admin can also add it)">
        <input type="text" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} disabled={busy} className={inputClass} />
      </FormField>

      <PrimaryButton onClick={submit} disabled={busy || !phone}>
        {busy ? 'Please wait…' : 'Continue'}
      </PrimaryButton>

      {error && <ErrorText>{error}</ErrorText>}
    </AuthLayout>
  );
}
