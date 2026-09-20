import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { useAuth } from '../auth/AuthProvider';
import { useChama } from './ChamaProvider';
import { NAV, BOTTOM_NAV } from './navConfig';
import { NavIcons } from './NavIcons';
import { SyncPill, OfflineBanner } from './SyncPill';

export default function AppShell() {
  const { user } = useAuth();
  const { chama, chamaId, membership, memberships, setChamaId } = useChama();
  const [moreOpen, setMoreOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const role = membership?.role ?? 'member';
  const items = NAV[role];
  const bottomIds = BOTTOM_NAV[role];
  const bottomItems = bottomIds.map((id) => items.find((i) => i.id === id)).filter(Boolean) as typeof items;
  const restItems = items.filter((i) => !bottomIds.includes(i.id));

  const currentItem = items.find((i) => i.path === location.pathname) ?? items[0];
  const initial = user?.displayName?.[0]?.toUpperCase() || user?.phoneNumber?.slice(-2) || 'U';

  return (
    <div className="fixed inset-0 bg-paper flex flex-col md:flex-row overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 border-r border-forest-100 bg-white flex-col min-h-0">
        <div className="h-16 flex items-center gap-2 px-5 border-b border-forest-100">
          <div className="w-7 h-7 rounded-md bg-forest-700 flex items-center justify-center text-gold-300 font-display font-bold text-sm">
            M
          </div>
          <span className="font-display font-semibold text-ink">MyChama</span>
        </div>

        {memberships.length > 1 && (
          <div className="px-3 pt-3">
            <select
              value={chamaId ?? ''}
              onChange={(e) => setChamaId(e.target.value)}
              className="w-full text-sm border border-forest-100 rounded-lg px-2 py-1.5"
            >
              {memberships.map((m) => (
                <option key={m.chamaId} value={m.chamaId}>
                  {m.chamaName}
                </option>
              ))}
            </select>
          </div>
        )}

        <nav className="flex-1 min-h-0 overflow-y-auto py-3 px-3 space-y-0.5">
          {items.map((item) => {
            const Icon = NavIcons[item.icon];
            return (
              <NavLink
                key={item.id}
                to={item.path}
                end={item.path === '/app'}
                className={({ isActive }) =>
                  `nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive ? 'active' : 'text-forest-900/70 hover:bg-forest-50'
                  }`
                }
              >
                <span className="text-forest-900/40">{Icon && <Icon />}</span>
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="p-3 border-t border-forest-100">
          <SyncPill />
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="h-16 border-b border-forest-100 bg-white/90 backdrop-blur flex items-center justify-between px-4 md:px-6 shrink-0">
          <div className="min-w-0">
            <h1 className="font-display font-semibold text-lg leading-tight truncate">{currentItem?.label}</h1>
            {chama && <p className="text-xs text-forest-900/50 truncate">{chama.name}</p>}
          </div>
          <div className="flex items-center gap-2 md:gap-3 shrink-0">
            <div className="md:hidden">
              <SyncPill />
            </div>
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen((o) => !o)}
                className="w-9 h-9 rounded-full bg-forest-700 text-white flex items-center justify-center font-display font-semibold text-sm"
              >
                {initial}
              </button>
              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-48 card shadow-card p-2 z-50">
                  <p className="px-2 py-1.5 text-xs text-forest-900/50 truncate">
                    {user?.displayName || user?.phoneNumber || user?.email}
                  </p>
                  <p className="px-2 pb-1.5 text-xs font-semibold text-forest-700 capitalize">{role}</p>
                  <button
                    onClick={() => signOut(auth)}
                    className="w-full text-left px-2 py-1.5 rounded-lg text-sm hover:bg-forest-50"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <OfflineBanner />

        <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 md:px-6 py-5 pb-24 md:pb-8">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-forest-100 flex items-stretch px-1 pb-[env(safe-area-inset-bottom)]">
        {bottomItems.map((item) => {
          const Icon = NavIcons[item.icon];
          const isActive = item.path === location.pathname;
          return (
            <NavLink
              key={item.id}
              to={item.path}
              end={item.path === '/app'}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 ${
                isActive ? 'text-forest-700' : 'text-forest-900/50'
              }`}
            >
              {Icon && <Icon />}
              <span className="text-[10px] font-medium">{item.label.replace('My ', '').replace(' & Settlement', '')}</span>
            </NavLink>
          );
        })}
        <button
          onClick={() => setMoreOpen(true)}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 text-forest-900/50"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="5" cy="12" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="19" cy="12" r="1.5" />
          </svg>
          <span className="text-[10px] font-medium">More</span>
        </button>
      </nav>

      {/* "More" sheet for mobile */}
      {moreOpen && (
        <div className="fixed inset-0 z-40 bg-ink/30 flex items-end md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="w-full bg-white rounded-t-2xl p-4 toast-in" onClick={(e) => e.stopPropagation()}>
            <p className="font-display font-semibold text-lg px-2 pb-3">More</p>
            {restItems.map((item) => {
              const Icon = NavIcons[item.icon];
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setMoreOpen(false);
                    navigate(item.path);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium hover:bg-forest-50"
                >
                  <span className="text-forest-900/40">{Icon && <Icon />}</span>
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
