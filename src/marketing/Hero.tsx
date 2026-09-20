/**
 * Public landing page — the app's "/" route for signed-out visitors
 * (signed-in users are redirected to /app by App.tsx). Content and layout
 * are ported from the original demo (MyChama_3_1.html)'s marketing
 * section — same copy, same Tailwind classes, same forest/gold design
 * tokens — condensed to the sections that carry the product's pitch:
 * hero, stat strip, and a features grid. The demo's fuller marketing site
 * (how-it-works, pricing, FAQ) can be ported the same way in a later pass;
 * flagged in the Phase 3 delivery notes rather than silently left out.
 */

import { Link } from 'react-router-dom';

const FEATURES: { title: string; body: string; badge?: string }[] = [
  { title: 'Members management', body: 'Profiles, ID/KYC details, join dates and standing — searchable from any admin\u2019s phone.' },
  { title: 'Contributions', body: 'Set the cycle and amount once. Collect by Paystack or record cash in two taps — every member\u2019s ledger updates itself.' },
  {
    title: 'Merry-go-round rotations',
    body: 'Daily, weekly or monthly table-banking pots with a fair lottery draw, live collection tracking, and members who miss payments automatically pushed to the back of the queue.',
    badge: 'New',
  },
  { title: 'Loans, flat or reducing', body: 'Run flat-rate and reducing-balance products side by side. Schedules, arrears and payoffs calculate themselves.' },
  { title: 'Bulk SMS to your members', body: 'One-way announcements and reminders, sent from SAMUHIA — no app required on their end to receive them.' },
  { title: 'Paystack payments & auto-settlement', body: 'Collections and disbursements move through Paystack, with settlements to your chama account on a schedule you set.' },
  { title: 'Minutes writer', body: 'Type the agenda and resolutions — MyChama formats and exports proper meeting minutes as a PDF.' },
  { title: 'Works with no signal', body: 'Meetings often happen where the network doesn\u2019t reach. MyChama keeps working and syncs everything once you\u2019re back online.' },
  { title: 'Three officials, one record', body: 'Chair, treasurer and secretary each get the right permissions — nobody\u2019s overwriting anybody\u2019s update.' },
];

export default function Hero() {
  return (
    <div className="bg-paper text-ink">
      <header className="sticky top-0 z-40 bg-paper/90 backdrop-blur border-b border-forest-100">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-forest-700 flex items-center justify-center text-gold-300 font-display font-bold text-base">
              M
            </div>
            <span className="font-display font-semibold text-lg tracking-tight">MyChama</span>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/signin" className="hidden sm:inline-block text-sm font-semibold text-forest-800 px-3 py-2 hover:text-forest-600">
              Log in
            </Link>
            <Link
              to="/create-chama"
              className="text-sm font-semibold bg-gold-400 hover:bg-gold-500 text-ink px-4 py-2.5 rounded-full transition-colors"
            >
              Get started
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* HERO */}
        <section className="max-w-6xl mx-auto px-5 pt-14 pb-16 md:pt-20 md:pb-24 grid md:grid-cols-2 gap-12 items-center">
          <div className="fade-up">
            <p className="text-forest-600 font-semibold text-sm mb-4">Built for chamas in Kenya</p>
            <h1 className="font-display text-4xl md:text-[2.75rem] leading-[1.08] font-semibold text-ink">
              Run your chama without turning it into someone's part-time job.
            </h1>
            <p className="mt-5 text-[17px] leading-relaxed text-forest-900/80 max-w-lg">
              MyChama gives your treasurer, chair and secretary one shared, offline-ready app for members,
              contributions, loans, M-Pesa collections, bulk SMS and meeting minutes — no more three different Excel
              sheets and a WhatsApp group holding it all together.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/create-chama"
                className="bg-forest-700 hover:bg-forest-800 text-white font-semibold px-6 py-3.5 rounded-full transition-colors"
              >
                Create your chama
              </Link>
              <Link
                to="/signin"
                className="font-semibold text-forest-800 px-6 py-3.5 rounded-full border border-forest-200 hover:bg-forest-50"
              >
                Sign in
              </Link>
            </div>
            <p className="mt-4 text-xs text-forest-900/50">Free plan available — no card required to start.</p>
          </div>

          <div className="relative fade-up" style={{ animationDelay: '.12s' }}>
            <div className="mx-auto w-[280px] rounded-[2.2rem] border-[6px] border-ink bg-ink p-1.5 shadow-2xl">
              <div className="rounded-[1.6rem] overflow-hidden bg-paper">
                <div className="bg-forest-700 text-white px-4 pt-4 pb-8 rounded-b-[1.4rem]">
                  <div className="flex items-center justify-between text-[11px] text-forest-100/80 mb-3">
                    <span>Sunrise Chama</span>
                    <span>●●● Online</span>
                  </div>
                  <p className="text-forest-100/70 text-xs">Group balance</p>
                  <p className="font-display text-2xl font-semibold mt-0.5">KES 486,200</p>
                </div>
                <div className="px-4 -mt-5 pb-4 space-y-2.5">
                  <div className="bg-white rounded-xl border border-forest-100 p-3 flex items-center justify-between shadow-card">
                    <div>
                      <p className="text-[11px] text-forest-900/50">Members</p>
                      <p className="font-display font-semibold text-sm">24 active</p>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-forest-50 flex items-center justify-center text-forest-600 text-xs font-semibold">
                      24
                    </div>
                  </div>
                  <div className="bg-white rounded-xl border border-forest-100 p-3 flex items-center justify-between shadow-card">
                    <div>
                      <p className="text-[11px] text-forest-900/50">Active loans</p>
                      <p className="font-display font-semibold text-sm">3 running</p>
                    </div>
                    <span className="chip bg-gold-50 text-gold-700">On track</span>
                  </div>
                  <div className="bg-white rounded-xl border border-forest-100 p-3 shadow-card">
                    <p className="text-[11px] text-forest-900/50 mb-1">This month's contributions</p>
                    <div className="h-2 rounded-full bg-forest-50 overflow-hidden">
                      <div className="h-full bg-gold-400" style={{ width: '78%' }} />
                    </div>
                    <p className="text-[11px] text-forest-900/50 mt-1">18 of 24 members paid</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="absolute -right-2 top-10 bg-white border border-forest-100 rounded-xl shadow-card px-3 py-2 text-xs hidden sm:block">
              <p className="text-forest-900/50">SMS sent</p>
              <p className="font-display font-semibold text-forest-700">via SAMUHIA</p>
            </div>
          </div>
        </section>

        {/* STAT STRIP */}
        <section className="border-y border-forest-100 bg-white">
          <div className="max-w-6xl mx-auto px-5 py-8 grid grid-cols-3 gap-6 text-center">
            <div>
              <p className="font-display text-2xl md:text-3xl font-semibold text-forest-700">24</p>
              <p className="text-xs md:text-sm text-forest-900/60 mt-1">members in a typical chama</p>
            </div>
            <div>
              <p className="font-display text-2xl md:text-3xl font-semibold text-forest-700">2 taps</p>
              <p className="text-xs md:text-sm text-forest-900/60 mt-1">to record a cash contribution</p>
            </div>
            <div>
              <p className="font-display text-2xl md:text-3xl font-semibold text-forest-700">Offline</p>
              <p className="text-xs md:text-sm text-forest-900/60 mt-1">queues changes, syncs when back online</p>
            </div>
          </div>
        </section>

        {/* FEATURES */}
        <section className="max-w-6xl mx-auto px-5 py-20">
          <div className="max-w-lg mb-12">
            <h2 className="font-display text-3xl font-semibold text-ink">Everything your officials juggle today, in one app.</h2>
            <p className="mt-3 text-forest-900/70">
              Not a spreadsheet with a login page. MyChama enforces your chama's own rules automatically, so
              contributions and loans stay consistent even when three different people are updating them from three
              different phones.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => (
              <div key={f.title} className={`card p-6 relative ${f.badge ? 'ring-1 ring-gold-300' : ''}`}>
                {f.badge && <span className="absolute -top-2.5 left-5 chip bg-gold-400 text-ink">{f.badge}</span>}
                <h3 className="font-display font-semibold text-base">{f.title}</h3>
                <p className="text-sm text-forest-900/65 mt-1.5">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="bg-forest-700 text-white">
          <div className="max-w-6xl mx-auto px-5 py-16 text-center">
            <h2 className="font-display text-3xl font-semibold mb-4">Ready to run your chama the easy way?</h2>
            <p className="text-forest-100/80 max-w-lg mx-auto mb-6">
              Set up your chama in a few minutes — free to start, with a paid plan when you're ready for online
              collections and bulk SMS.
            </p>
            <Link
              to="/create-chama"
              className="inline-block bg-gold-400 hover:bg-gold-500 text-ink font-semibold px-7 py-3.5 rounded-full transition-colors"
            >
              Create your chama
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-forest-100 py-8">
        <div className="max-w-6xl mx-auto px-5 text-xs text-forest-900/50 flex items-center justify-between">
          <span>© {new Date().getFullYear()} MyChama</span>
          <span>By Samuhia</span>
        </div>
      </footer>
    </div>
  );
}
