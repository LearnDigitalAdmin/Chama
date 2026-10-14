/**
 * Single source of truth for everything the Terms & Conditions and the Privacy
 * Policy state about the company, contact routes, dates and retention windows.
 *
 * Money figures (plans, fees, report prices) are NOT repeated here — the legal
 * pages import them from src/lib/constants.ts so a price change there can never
 * leave the published terms quoting a different number.
 *
 * Changing the wording in a way that affects people's rights? Bump `version` and
 * `effectiveDate`, and tell users (see docs/LEGAL.md).
 */
import { SITE } from '../seo/site';

export const LEGAL = {
  /** Registered business name. */
  company: 'SAMUHIA BUSINESSES KENYA',
  /** Short name used in running text and as the SMS sender name. */
  brand: 'Samuhia',
  smsSenderName: 'SAMUHIA',
  product: 'MyChama',
  /** Registered in Kenya; operates from Nakuru. */
  place: 'Nakuru, Kenya',
  siteUrl: SITE.url,
  email: SITE.supportEmail,

  version: '1.0',
  /** ISO date this version took effect. */
  effectiveDate: '2026-10-14',

  /**
   * Office of the Data Protection Commissioner registration number.
   * Leave empty until issued — the Privacy Policy only shows the line when this is set.
   */
  odpcRegistrationNumber: '',

  /** Days. Keep in sync with the Firestore TTL policy set on the technical-log collections (docs/LEGAL.md). */
  technicalLogRetentionDays: 90,
  /** Years financial records are kept after a chama closes (Kenyan accounting / tax record-keeping). */
  financialRecordRetentionYears: 7,
  /** How long a generated report download link stays valid (functions/mychama/billing.py STATEMENT_URL_TTL). */
  reportLinkHours: 48,
  /** Days we aim to answer a privacy request (Data Protection Act, 2019 regulations). */
  privacyRequestDays: 30,
  /** Fallback liability cap (KES) when a chama has paid nothing in the previous 12 months. */
  liabilityFloorKes: 5000,
} as const;

export const LEGAL_PATHS = {
  terms: '/terms',
  privacy: '/privacy',
} as const;

export function formatEffectiveDate(): string {
  return new Date(LEGAL.effectiveDate + 'T00:00:00+03:00').toLocaleDateString('en-KE', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Nairobi',
  });
}
