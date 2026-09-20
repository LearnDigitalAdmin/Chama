/**
 * /claim/:chamaId/:inviteId — the link an admin shares (SMS/WhatsApp/email)
 * with someone they've added via addAdmin/addMember. Requires the visitor
 * to already be signed in with the SAME phone number the invite was
 * created for (see functions/mychama/identity.py::claimInvite) — if
 * they're not signed in yet, route them to phone sign-in first with a
 * return path back here.
 */

import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { claimInvite } from '../lib/callables';
import { useAuth } from '../auth/AuthProvider';
import AuthLayout, { ErrorText, PrimaryButton } from '../auth/AuthLayout';

export default function ClaimInvite() {
  const { chamaId, inviteId } = useParams<{ chamaId: string; inviteId: string }>();
  const { user, authReady } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function claim() {
    if (!chamaId || !inviteId) return;
    setError(null);
    setBusy(true);
    try {
      await claimInvite({ chamaId, inviteId });
      navigate('/', { replace: true });
    } catch (e) {
      const code = (e as { code?: string })?.code || '';
      if (code.includes('permission-denied')) {
        setError("This invite is for a different phone number than the one you're signed in with.");
      } else if (code.includes('failed-precondition')) {
        setError('This invite has already been used or has expired.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (!authReady) return <AuthLayout title="Loading…">{null}</AuthLayout>;

  if (!user) {
    return (
      <AuthLayout title="You've been invited to a chama" subtitle="Sign in with the phone number your admin used to add you, then come back to this link.">
        <PrimaryButton onClick={() => navigate(`/signin/phone?next=/claim/${chamaId}/${inviteId}`)}>
          Sign in with phone
        </PrimaryButton>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="You've been invited to a chama" subtitle={`Signed in as ${user.phoneNumber || user.email}.`}>
      <PrimaryButton onClick={claim} disabled={busy}>
        {busy ? 'Joining…' : 'Join chama'}
      </PrimaryButton>
      {error && <ErrorText>{error}</ErrorText>}
    </AuthLayout>
  );
}
