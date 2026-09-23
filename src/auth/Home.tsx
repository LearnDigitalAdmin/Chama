/**
 * Post-sign-in landing. Redirects straight into the app shell once the
 * user has at least one chama; otherwise offers to create one.
 */

import { signOut } from 'firebase/auth';
import { Link, Navigate } from 'react-router-dom';
import { auth } from '../lib/firebase';
import { useAuth } from './AuthProvider';
import AuthLayout, { LinkButton } from './AuthLayout';

export default function Home() {
  const { user, memberships, membershipsReady, claimingInvites } = useAuth();

  if (!membershipsReady || claimingInvites) {
    return (
      <AuthLayout title={claimingInvites ? 'Checking for pending invites…' : 'Loading your chamas…'}>
        <div className="h-1.5 w-full bg-forest-50 rounded-full overflow-hidden">
          <div className="h-full w-1/2 bg-gold-400 animate-pulse" />
        </div>
      </AuthLayout>
    );
  }

  if (memberships.length > 0) {
    return <Navigate to="/app" replace />;
  }

  return (
    <AuthLayout title={`Welcome${user?.displayName ? `, ${user.displayName}` : ''}`} subtitle={user?.phoneNumber || user?.email || undefined}>
      <p className="text-sm text-forest-900/70">You're not part of any chama yet.</p>
      <Link to="/create-chama" className="btn-primary font-semibold px-4 py-2.5 rounded-full text-center transition-colors">
        Create a chama
      </Link>
      <p className="text-xs text-forest-900/50">
        Already been added by an admin? Make sure you're signing in with the exact phone number they used to add you
        — we check for that automatically each time you sign in.
      </p>
      <LinkButton onClick={() => signOut(auth)}>Sign out</LinkButton>
    </AuthLayout>
  );
}
