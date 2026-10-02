/**
 * Single source of truth for the public marketing copy.
 *
 * Used by:
 *  - src/marketing/Hero.tsx + Sections.tsx        (what people see)
 *  - tools/vite-plugin-pwa-seo.ts                 (FAQ JSON-LD, <noscript> fallback, /llms-full.txt)
 *
 * Because the FAQ structured data is generated from THIS array, it can never drift
 * from the visible FAQ — Google requires those to match for FAQ rich results.
 * Keep this file import-free (Node loads it at build time).
 */

export interface Feature { title: string; body: string; badge?: string }
export interface Faq { q: string; a: string }
export interface Step { title: string; body: string }

export const SEO_COPY = {
  title: 'MyChama — Chama Management App for Kenya | Contributions, Loans, Merry-Go-Round',
  description:
    'Run your chama from one offline-ready app: members, contributions, loans, merry-go-round rotations, M-Pesa & Paystack collections, bulk SMS and minutes. Free plan available.',
  h1: "Run your chama without turning it into someone's part-time job.",
  keywords:
    'chama app Kenya, chama management software, chama contributions tracker, merry-go-round app, table banking app, chama loans calculator, M-Pesa chama, chama SMS reminders, chama minutes, MyChama, Samuhia',
  tagline: 'Chama management for Kenya — offline-first, built for phones.',
} as const;

export const FEATURES: Feature[] = [
  { title: 'Members management', body: 'Profiles, ID/KYC details, join dates and standing — searchable from any admin\u2019s phone.' },
  { title: 'Contributions', body: 'Set the cycle and amount once. Collect by Paystack or record cash in two taps — every member\u2019s ledger updates itself.' },
  {
    title: 'Merry-go-round rotations',
    body: 'Daily, weekly or monthly table-banking pots with a fair lottery draw, live collection tracking, and members who miss payments automatically pushed to the back of the queue.',
    badge: 'New',
  },
  { title: 'Loans, flat or reducing', body: 'Run flat-rate and reducing-balance products side by side. Schedules, arrears and payoffs calculate themselves.' },
  { title: 'Bulk SMS to your members', body: 'One-way announcements and reminders, sent from SAMUHIA — no app required on their end to receive them.' },
  { title: 'Paystack payments & auto-settlement', body: 'Online collections run through Paystack on paid plans, with settlements to your chama\u2019s own account on a schedule you set.' },
  { title: 'Minutes writer', body: 'Type the agenda and resolutions — MyChama formats proper meeting minutes, ready to export as a PDF on paid plans.' },
  { title: 'Works with no signal', body: 'Meetings often happen where the network doesn\u2019t reach. MyChama keeps working and syncs everything once you\u2019re back online.' },
  { title: 'Three officials, one record', body: 'Chair, treasurer and secretary each get the right permissions — nobody\u2019s overwriting anybody\u2019s update.' },
  { title: 'Financial reports', body: 'Member statements, contribution ledgers, arrears reports, cashflow, profit & loss and balance sheet — exported for your AGM on paid plans.' },
  { title: 'Install it like an app', body: 'Add MyChama to your phone\u2019s home screen or your computer\u2019s desktop in one tap. No app store, no big download, and it updates itself.' },
];

export const HOW_IT_WORKS: Step[] = [
  { title: 'Set up members and rules', body: 'Add your members, set the contribution cycle, and define your loan products — flat rate or reducing balance, with your own limits.' },
  { title: 'Collect, lend, rotate', body: 'Members pay by Paystack or an admin records cash in two taps. Loans need the chair and treasurer to approve before money moves; merry-go-round pots run their own fair draw.' },
  { title: 'Report and notify, automatically', body: 'SMS reminders go out from SAMUHIA, settlements land on schedule, and minutes and reports are ready to export.' },
];

export const FAQS: Faq[] = [
  {
    q: 'What is MyChama?',
    a: 'MyChama is chama management software built for Kenyan savings and investment groups. It gives your chair, treasurer and secretary one shared, offline-ready app for members, contributions, loans, merry-go-round rotations, M-Pesa and Paystack collections, bulk SMS, meeting minutes and financial reports. It is made by Samuhia.',
  },
  {
    q: "Is my chama's money safe with MyChama?",
    a: "MyChama does not hold your chama's money. Online collections are processed by Paystack and settle to your chama's own paybill, till or bank account; MyChama keeps the records — who paid, who borrowed, whose turn it is.",
  },
  {
    q: 'Can I install MyChama on my phone?',
    a: 'Yes. MyChama is an installable web app (PWA). On Android and desktop Chrome or Edge, tap "Install app" when prompted. On iPhone, open MyChama in Safari, tap Share, then "Add to Home Screen". There is no app store step, and it updates itself.',
  },
  {
    q: 'Does it really work with no internet?',
    a: 'Yes. Admins can record cash contributions, log loan repayments, apply for and approve loans, and write meeting minutes with no signal. Changes are saved on the device and sync automatically the next time it gets a connection. Sending SMS and online payments do need a connection.',
  },
  {
    q: 'Which loan methods are supported?',
    a: 'Each loan product is either flat-rate (interest on the original amount, split evenly) or reducing-balance (interest on what is still owed). A chama can run an Emergency loan and a Development loan side by side, each with its own rate, limit and term.',
  },
  {
    q: 'Who can approve a loan?',
    a: 'Both the chair and the treasurer must approve a loan application before it can be disbursed, so no single official can move chama money alone.',
  },
  {
    q: 'Does the merry-go-round feature cost extra?',
    a: 'No. Merry-go-round rotations with fair lottery draws and daily collection tracking are included on every plan, including Free (payouts are recorded in cash for now). Collecting contributions online through Paystack needs a paid plan.',
  },
  {
    q: 'What stops someone taking the payout and then not paying?',
    a: 'With late-payer protection on, members who miss contributions automatically drift toward the back of the merry-go-round queue based on their recent record, so a chronically late member is far less likely to reach the front.',
  },
  {
    q: 'What reports can MyChama produce?',
    a: 'Individual member statements, contribution summary and tracking ledgers, arrears and penalties reports, meeting minutes, and the premium financial statements: cashflow, profit & loss and balance sheet. Exports are available on paid plans; the Free plan has no Excel or PDF export.',
  },
  {
    q: 'What happens when our plan expires?',
    a: "If a paid plan isn't renewed, your chama automatically drops to the Free plan at expiry. Your records stay, but the Free plan's member and feature limits apply until you upgrade again.",
  },
  {
    q: 'Why do SMS messages come from "SAMUHIA" and not our chama\u2019s name?',
    a: "Every message MyChama sends, for every chama on the platform, arrives from SAMUHIA — the one registered sender name all chamas share, which keeps delivery reliable. Delivery works best to Safaricom numbers.",
  },
];

/** Benefits shown in the install prompt and the "Get the app" section. */
export const INSTALL_BENEFITS: string[] = [
  'Opens full-screen from your home screen',
  'Keeps working with no signal',
  'Loads faster and updates itself',
];
