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
    // Create-once guard, deliberately with NO cleanup/.clear() here.
    //
    // Bug history: this used to create the verifier on mount and call
    // verifierRef.current?.clear() + set it back to null on cleanup. That
    // is safe on a real unmount, but in development <StrictMode> (see
    // src/main.tsx) mounts every component twice — mount, cleanup, mount —
    // against the *same* <div id={RECAPTCHA_CONTAINER_ID}/> DOM node
    // (React does not recreate that node between the two passes). Google's
    // reCAPTCHA script keeps its own internal record of which DOM node it
    // has rendered into, and RecaptchaVerifier.clear() does not fully erase
    // that record before the second verifier renders into the same node.
    // The result: the very first time the *second* verifier is asked to
    // render — which happens inside signInWithPhoneNumber(), before any
    // SMS request goes out — it throws a plain Error (no .code), e.g.
    // "reCAPTCHA has already been rendered in this element". That falls
    // through every case in friendlyAuthError() to the generic "Something
    // went wrong" message: sign-in fails instantly, the OTP is never sent,
    // and it never looks like a rate-limit error. See console logs below.
    if (!verifierRef.current) {
      console.log('[PhoneSignIn] creating RecaptchaVerifier for container', RECAPTCHA_CONTAINER_ID);
      verifierRef.current = new RecaptchaVerifier(auth, RECAPTCHA_CONTAINER_ID, { size: 'invisible' });
    } else {
      console.log('[PhoneSignIn] reusing existing RecaptchaVerifier (effect re-ran, e.g. StrictMode dev double-invoke)');
    }
  }, []);

  async function sendCode() {
    setError(null);
    console.log('[PhoneSignIn] sendCode() called with raw input:', phone);

    if (!isValidKenyanPhone(phone)) {
      console.warn('[PhoneSignIn] validation failed for phone:', phone, '-> normalized:', normalizePhone(phone));
      setError('Enter a valid Kenyan phone number, e.g. 0712345678.');
      return;
    }

    setBusy(true);
    try {
      const verifier = verifierRef.current;
      if (!verifier) {
        // Should not happen, but this is exactly the kind of silent,
        // pre-network failure the user reported — log loudly if it does.
        console.error('[PhoneSignIn] no RecaptchaVerifier available — aborting before network request');
        throw new Error('Verification is not ready yet. Please refresh and try again.');
      }
      const normalized = normalizePhone(phone);
      console.log('[PhoneSignIn] calling signInWithPhoneNumber with', normalized);
      const result = await signInWithPhoneNumber(auth, normalized, verifier);
      console.log('[PhoneSignIn] signInWithPhoneNumber succeeded, OTP sent, awaiting code');
      setConfirmation(result);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      const message = (e as { message?: string })?.message;
      console.error('[PhoneSignIn] sendCode() failed before/while sending OTP — code:', code, 'message:', message, e);
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (!confirmation) return;
    setError(null);
    setBusy(true);
    console.log('[PhoneSignIn] verifyCode() called, otp length:', otp.trim().length);
    try {
      await confirmation.confirm(otp.trim());
      console.log('[PhoneSignIn] OTP confirmed, navigating to', next);
      navigate(next, { replace: true });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      const message = (e as { message?: string })?.message;
      console.error('[PhoneSignIn] verifyCode() failed — code:', code, 'message:', message, e);
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
  const message = (e as { message?: string })?.message || '';
  if (code.includes('invalid-phone-number')) return 'That phone number looks invalid.';
  if (code.includes('too-many-requests')) return 'Too many attempts. Please wait a moment and try again.';
  if (code.includes('invalid-verification-code')) return 'That code is incorrect. Check and try again.';
  if (code.includes('code-expired')) return 'That code expired. Request a new one.';
  // No .code — this is the reCAPTCHA-widget-conflict class of error (see the
  // useEffect comment above). A full page refresh gives a clean DOM node.
  if (message.includes('already been rendered')) return 'Please refresh the page and try again.';
  return 'Something went wrong. Please try again.';
}
