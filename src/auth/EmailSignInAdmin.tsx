/**
 * Email + password — primary method for admins. Firebase requires
 * verification before createChama will succeed (checked server-side, see
 * functions/mychama/identity.py::createChama) — this screen enforces it in
 * the UI too, with a resend option, so an admin isn't left guessing why
 * chama creation is rejected.
 */

import { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { auth } from '../lib/firebase';
import AuthLayout, { ErrorText, FormField, PrimaryButton, LinkButton, inputClass } from './AuthLayout';

type Mode = 'signin' | 'signup';

export default function EmailSignInAdmin() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resent, setResent] = useState(false);
  const navigate = useNavigate();

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signup') {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await sendEmailVerification(cred.user);
        setNeedsVerification(true);
      } else {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        if (!cred.user.emailVerified) {
          setNeedsVerification(true);
        } else {
          navigate('/', { replace: true });
        }
      }
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    if (!auth.currentUser) return;
    await sendEmailVerification(auth.currentUser);
    setResent(true);
  }

  if (needsVerification) {
    return (
      <AuthLayout title="Verify your email">
        <p className="text-sm text-forest-900/70">
          We sent a verification link to <strong className="text-ink">{email}</strong>. Click it, then come back and
          continue — you can't create a chama with an unverified email.
        </p>
        <PrimaryButton onClick={() => navigate('/', { replace: true })}>I've verified — continue</PrimaryButton>
        <LinkButton onClick={resendVerification}>{resent ? 'Sent again ✓' : 'Resend verification email'}</LinkButton>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={mode === 'signin' ? 'Admin sign in' : 'Create an admin account'}>
      <FormField label="Email">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} className={inputClass} />
      </FormField>
      <FormField label="Password">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
          className={inputClass}
        />
      </FormField>

      <PrimaryButton onClick={submit} disabled={busy || !email || password.length < 6}>
        {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
      </PrimaryButton>

      <LinkButton onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')} disabled={busy}>
        {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
      </LinkButton>

      {error && <ErrorText>{error}</ErrorText>}
    </AuthLayout>
  );
}

function friendlyAuthError(e: unknown): string {
  const code = (e as { code?: string })?.code || '';
  if (code.includes('email-already-in-use')) return 'An account with that email already exists — sign in instead.';
  if (code.includes('invalid-credential') || code.includes('wrong-password')) return 'Incorrect email or password.';
  if (code.includes('user-not-found')) return 'No account found with that email.';
  if (code.includes('weak-password')) return 'Choose a password with at least 6 characters.';
  if (code.includes('invalid-email')) return 'That email address looks invalid.';
  return 'Something went wrong. Please try again.';
}
