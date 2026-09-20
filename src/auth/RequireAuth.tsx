import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user, authReady } = useAuth();

  if (!authReady) return <div className="auth-card">Loading…</div>;
  if (!user) return <Navigate to="/signin" replace />;

  return <>{children}</>;
}
