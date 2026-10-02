import { Link } from 'react-router-dom';
import { PLANS, PLAN_COPY, PLAN_ORDER } from '../lib/constants';
import { FAQS, HOW_IT_WORKS, INSTALL_BENEFITS } from './content';
import BrandMark from '../brand/BrandMark';
import InstallButton from '../pwa/InstallButton';
import { installSteps } from '../pwa/installSteps';
import { usePWA } from '../pwa/usePWA';

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-h" className="bg-white border-y border-forest-100">
      <div className="max-w-6xl mx-auto px-5 py-20">
        <h2 id="how-h" className="font-display text-3xl font-semibold text-ink max-w-lg">How MyChama works</h2>
        <ol className="mt-10 grid md:grid-cols-3 gap-5">
          {HOW_IT_WORKS.map((s, i) => (
            <li key={s.title} className="card p-6">
              <span className="w-8 h-8 rounded-full bg-forest-700 text-gold-300 font-display font-bold text-sm flex items-center justify-center">{i + 1}</span>
              <h3 className="font-display font-semibold mt-4">{s.title}</h3>
              <p className="text-sm text-forest-900/65 mt-1.5">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function PricingSection() {
  return (
    <section id="pricing" aria-labelledby="pricing-h" className="max-w-6xl mx-auto px-5 py-20">
      <h2 id="pricing-h" className="font-display text-3xl font-semibold text-ink">Simple monthly pricing in KES</h2>
      <p className="mt-3 text-forest-900/70 max-w-xl">Start free with a small group. Upgrade when you want online collections, exports and more members.</p>
      <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {PLAN_ORDER.map((key) => {
          const plan = PLANS[key];
          return (
            <div key={key} className="card p-5 flex flex-col">
              <h3 className="font-display font-semibold">{plan.name}</h3>
              <p className="mt-2 font-display text-2xl font-semibold text-forest-700">
                {plan.price === 0 ? 'Free' : `KES ${plan.price.toLocaleString('en-KE')}`}
                {plan.price > 0 && <span className="text-xs font-normal text-forest-900/50"> /month</span>}
              </p>
              <p className="text-xs text-forest-900/60 mt-1">{PLAN_COPY[key].blurb}</p>
              <ul className="mt-4 space-y-1.5 text-xs text-forest-900/75">
                {PLAN_COPY[key].features.map((f) => (
                  <li key={f} className="flex gap-1.5"><span className="text-forest-500">✓</span><span>{f}</span></li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function FaqSection() {
  return (
    <section id="faq" aria-labelledby="faq-h" className="bg-white border-y border-forest-100">
      <div className="max-w-3xl mx-auto px-5 py-20">
        <h2 id="faq-h" className="font-display text-3xl font-semibold text-ink">Frequently asked questions</h2>
        <div className="mt-8 divide-y divide-forest-100 border-y border-forest-100">
          {FAQS.map((f) => (
            <details key={f.q} className="group py-4">
              <summary className="cursor-pointer list-none flex items-center justify-between gap-4 font-display font-semibold text-ink">
                {f.q}<span className="text-forest-500 transition-transform group-open:rotate-45 text-xl leading-none">+</span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-forest-900/70">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/** "Download the app" block — always visible on the landing page, adapts to the visitor's browser. */
export function GetTheApp() {
  const { installed, platform, browser, inAppBrowser, canInstallHere } = usePWA();
  const { steps } = installSteps({ platform, browser, inAppBrowser });
  return (
    <section id="get-the-app" aria-labelledby="app-h" className="max-w-6xl mx-auto px-5 py-20">
      <div className="card p-8 md:p-10 grid md:grid-cols-2 gap-8 items-center">
        <div>
          <div className="flex items-center gap-3"><BrandMark size={52} /><h2 id="app-h" className="font-display text-2xl md:text-3xl font-semibold text-ink">Get the MyChama app</h2></div>
          <p className="mt-4 text-forest-900/70">Install MyChama on your phone or computer — free, no app store, and it updates itself.</p>
          <ul className="mt-4 space-y-1.5 text-sm text-forest-900/75">
            {INSTALL_BENEFITS.map((b) => <li key={b} className="flex gap-2"><span className="text-forest-500">✓</span>{b}</li>)}
          </ul>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {installed ? (
              <span className="chip bg-forest-50 text-forest-700">✓ You’re using the installed app</span>
            ) : canInstallHere ? (
              <InstallButton tone="solid" className="!h-11 !px-5" />
            ) : (
              <Link to="/signin" className="btn-primary font-semibold px-6 py-3 rounded-full">Open MyChama</Link>
            )}
          </div>
        </div>
        {!installed && (
          <div className="bg-paper rounded-xl border border-forest-100 p-5">
            <p className="font-display font-semibold text-sm text-ink">How to install on this device</p>
            <ol className="mt-3 space-y-2.5">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-3 text-sm text-forest-900/75">
                  <span className="w-6 h-6 shrink-0 rounded-full bg-forest-100 text-forest-700 text-xs font-bold flex items-center justify-center">{i + 1}</span>{s}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}
