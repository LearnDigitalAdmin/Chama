/**
 * Phone sign-in — primary auth method for members.
 *
 * Uses invisible reCAPTCHA against RECAPTCHA_CONTAINER_ID (src/lib/firebase.ts)
 * so a returning member never sees a puzzle. Session persistence is already
 * configured globally (browserLocalPersistence) — a member who completes
 * this once will not be asked again on this device until they sign out,
 * which is the entire point: phone auth is billed per OTP.
 */

import { useEffect, useRef, useState } from 'react';
import { RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from 'firebase/auth';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { auth, RECAPTCHA_CONTAINER_ID } from '../lib/firebase';
import { isValidKenyanPhone, normalizePhone } from '../lib/phone';
import AuthLayout, { ErrorText, FormField, PrimaryButton, LinkButton, inputClass } from './AuthLayout';

export default function PhoneSignIn() {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const verifierRef = useRef<RecaptchaVerifier | null>(null);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';

  useEffect(() => {
    if (!verifierRef.current) {
      verifierRef.current = new RecaptchaVerifier(auth, RECAPTCHA_CONTAINER_ID, { size: 'invisible' });
    }
    return () => {
      verifierRef.current?.clear();
      verifierRef.current = null;
    };
  }, []);

  async function sendCode() {
    setError(null);
    if (!isValidKenyanPhone(phone)) {
      setError('Enter a valid Kenyan phone number, e.g. 0712345678.');
      return;
    }
    setBusy(true);
    try {
      const verifier = verifierRef.current!;
      const result = await signInWithPhoneNumber(auth, normalizePhone(phone), verifier);
      setConfirmation(result);
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (!confirmation) return;
    setError(null);
    setBusy(true);
    try {
      await confirmation.confirm(otp.trim());
      navigate(next, { replace: true });
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Sign in with your phone" subtitle="We'll text you a one-time code.">
      {!confirmation ? (
        <>
          <FormField label="Phone number">
            <input
              type="tel"
              inputMode="tel"
              placeholder="0712345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={busy}
              className={inputClass}
            />
          </FormField>
          <PrimaryButton onClick={sendCode} disabled={busy || !phone}>
            {busy ? 'Sending…' : 'Send code'}
          </PrimaryButton>
        </>
      ) : (
        <>
          <p className="text-sm text-forest-900/70">Enter the code sent to {normalizePhone(phone)}.</p>
          <FormField label="Verification code">
            <input
              type="text"
              inputMode="numeric"
              placeholder="123456"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              disabled={busy}
              className={inputClass}
            />
          </FormField>
          <PrimaryButton onClick={verifyCode} disabled={busy || otp.length < 4}>
            {busy ? 'Verifying…' : 'Verify & continue'}
          </PrimaryButton>
          <LinkButton onClick={() => setConfirmation(null)} disabled={busy}>
            Use a different number
          </LinkButton>
        </>
      )}

      {error && <ErrorText>{error}</ErrorText>}

      {/* Invisible reCAPTCHA renders into this container; nothing visible on screen. */}
      <div id={RECAPTCHA_CONTAINER_ID} />
    </AuthLayout>
  );
}

function friendlyAuthError(e: unknown): string {
  const code = (e as { code?: string })?.code || '';
  if (code.includes('invalid-phone-number')) return 'That phone number looks invalid.';
  if (code.includes('too-many-requests')) return 'Too many attempts. Please wait a moment and try again.';
  if (code.includes('invalid-verification-code')) return 'That code is incorrect. Check and try again.';
  if (code.includes('code-expired')) return 'That code expired. Request a new one.';
  return 'Something went wrong. Please try again.';
}
