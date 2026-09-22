import { useChama } from './ChamaProvider';
import AdminDashboard from '../features/dashboard/AdminDashboard';
import MemberDashboard from '../features/dashboard/MemberDashboard';

/**
 * Home. Phase 1/2 shipped a placeholder here; Phase 4 replaces it with the
 * real admin/member split the demo always had (renderDashboard vs
 * renderMemberDashboard) — see AdminDashboard.tsx and MemberDashboard.tsx.
 */
export default function Dashboard() {
  const { chama, chamaReady, membership } = useChama();

  if (!chamaReady) return <p className="text-forest-900/60">Loading…</p>;
  if (!chama) return <p className="text-forest-900/60">No chama selected.</p>;

  return membership?.role === 'member' ? <MemberDashboard /> : <AdminDashboard />;
}
