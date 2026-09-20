import { Link } from 'react-router-dom';
import { useChama } from './ChamaProvider';
import { kes } from '../lib/money';
import { PLANS } from '../lib/constants';

export default function Dashboard() {
  const { chama, chamaReady, membership } = useChama();

  if (!chamaReady) return <p className="text-forest-900/60">Loading…</p>;
  if (!chama) return <p className="text-forest-900/60">No chama selected.</p>;

  const plan = PLANS[chama.plan];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">{chama.name}</h1>
        {chama.motto && <p className="text-forest-900/60 text-sm mt-0.5">{chama.motto}</p>}
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="text-xs text-forest-900/50">Your role</p>
          <p className="font-display font-semibold text-lg capitalize mt-0.5">{membership?.role}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-forest-900/50">Contribution</p>
          <p className="font-display font-semibold text-lg mt-0.5">
            {kes(chama.contributionAmount)} <span className="text-sm font-normal text-forest-900/50">/ {chama.contributionCycle}</span>
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-forest-900/50">Plan</p>
          <p className="font-display font-semibold text-lg mt-0.5">
            {plan.name} <span className="chip bg-forest-50 text-forest-700 ml-1">{plan.memberLimit >= 999 ? '∞' : plan.memberLimit} members</span>
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {[
          ['/app/contributions', 'Contributions'],
          ['/app/loans', 'Loans'],
          ['/app/mgr', 'Merry-Go-Round'],
          ['/app/minutes', 'Minutes'],
        ].map(([path, label]) => (
          <Link
            key={path}
            to={path}
            className="btn-primary font-semibold px-5 py-2.5 rounded-full transition-colors text-sm"
          >
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}
