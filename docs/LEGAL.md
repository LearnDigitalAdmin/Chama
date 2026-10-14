# Legal pages — Terms & Conditions and Privacy Policy

Public routes: `/terms` and `/privacy` (indexable, listed in `public/sitemap.xml` and `public/llms.txt`).
They are linked from the landing-page footer, under every sign-in / onboarding card (`AuthLayout`), and in the signed-in user menu (`AppShell`).

## Files

| File | What it is |
|---|---|
| `src/legal/legalConfig.ts` | Company name, contact, **version + effective date**, retention windows, liability floor. Edit facts here. |
| `src/legal/LegalLayout.tsx` | Shared page shell (table of contents, anchors, mobile jump menu) and content primitives. |
| `src/legal/TermsPage.tsx` | Terms & Conditions (27 sections). |
| `src/legal/PrivacyPage.tsx` | Privacy Policy (16 sections). |

## Never drifts from the product

Plan prices, member limits, report credits, Paystack and MyChama fee rates, SMS segment limits,
payment-prompt expiry and WhatsApp lockout windows are **imported** from `src/lib/constants.ts` and
`src/lib/smsValidation.ts`. Change a number there and both pages update on the next build.

## When to edit the pages (keep them true)

Update the wording — and bump `version` / `effectiveDate` in `legalConfig.ts` — whenever you:

- add or replace an outside provider (SMS gateway, payment processor, analytics, error tracking, fonts, maps…) → Privacy §6 table, §3 table if it receives new data, and the "no analytics / no trackers" statements;
- collect a new kind of personal data, or change who can read ID numbers → Privacy §3, §7;
- change where data is stored (Firestore location, function regions) → Privacy §8;
- add online payouts / disbursements (today loans and merry-go-round payouts are recorded cash only) → Terms §3, §7, §8, §9;
- change refunds, plan expiry behaviour, or SMS credit rules → Terms §6, §10;
- start sending our own marketing → Privacy §4 and §14 (requires consent first).

## Operational follow-ups the text relies on

1. **Technical-log TTL.** Privacy §12 says WhatsApp audit / rate-limit logs are deleted after `technicalLogRetentionDays` (90). Set a Firestore TTL policy to match, e.g.
   `gcloud firestore fields ttl-policies update expiresAt --collection-group=whatsappAuditLog --enable-ttl`
   (see TOUCH_BASE.md, deploy step 3). If you pick a different period, change the number in `legalConfig.ts`.
2. **ODPC registration.** Register as a data controller/processor with the Office of the Data Protection Commissioner, then put the number in `odpcRegistrationNumber`; the Privacy Policy shows it automatically once set.
3. **Legal review.** Have a Kenyan advocate review the final text before launch (liability cap, indemnity, retention period, governing-law clause).
