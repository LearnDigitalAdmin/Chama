import { useSeo } from '../seo/useSeo';
import { SECURITY } from '../lib/constants';
import LegalLayout, { Callout, H3, Mail, P, Table, TermsLink, UL, type LegalSection } from './LegalLayout';
import { LEGAL, LEGAL_PATHS } from './legalConfig';

const mins = (s: number) => Math.round(s / 60);

const sections: LegalSection[] = [
  /* ------------------------------------------------------------------ 1 */
  {
    id: 'summary',
    title: 'The short version',
    body: (
      <>
        <P>
          This policy explains what personal information {LEGAL.product} collects, why, who can see it, and what your rights are. It applies to everyone who uses {LEGAL.product}: chama officials, members,
          and people who receive our SMS. It is written to follow the <strong>Data Protection Act, 2019</strong> of Kenya.
        </P>
        <Callout title="In plain words">
          <UL>
            <li><strong>We never sell your data.</strong> We do not rent it, trade it, or give it to advertisers, data brokers or marketers.</li>
            <li><strong>We use your data only to run {LEGAL.product}</strong> — to sign you in, keep your chama's records, take payments, send the SMS and WhatsApp messages the service needs, and keep it secure.</li>
            <li><strong>No advertising, no tracking.</strong> We have no ad networks, no analytics or social-media trackers, and we set no tracking cookies. We do not build marketing profiles or score people.</li>
            <li><strong>A few providers run the technology for us</strong> (Google for hosting and sign-in, Paystack for payments, an SMS provider, and WhatsApp for the assistant). They receive only what they need to do that job. They are listed in full in section 6.</li>
            <li><strong>Your chama's officials see more than other members.</strong> Section 7 shows who sees what.</li>
            <li><strong>You have rights</strong> to see, correct and, where the law allows, delete your data — see section 11.</li>
          </UL>
        </Callout>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 2 */
  {
    id: 'who',
    title: 'Who is responsible for your data',
    body: (
      <>
        <P>
          <strong>{LEGAL.company}</strong> ("{LEGAL.brand}", "we"), registered in Kenya and operating from {LEGAL.place}, runs {LEGAL.product}. You can reach us at <Mail />.
          {LEGAL.odpcRegistrationNumber && <> We are registered with the Office of the Data Protection Commissioner (registration number {LEGAL.odpcRegistrationNumber}).</>}
        </P>
        <P>The Data Protection Act distinguishes two roles, and we act in both:</P>
        <UL>
          <li>
            <strong>We are the data controller</strong> for information about you as a user of {LEGAL.product}: your account and sign-in details, your payments for plans, SMS and reports,
            security and fraud checks, and your communication with our support. We decide why and how that data is used.
          </li>
          <li>
            <strong>We are a data processor for your chama</strong> for the member records and chama records its officials enter (member lists, ID numbers, contributions, loans, merry-go-round pots, minutes, messages).
            The chama decides what to collect and why; we store and process it on the chama's behalf, to deliver the service. Chama officials are responsible for having a proper basis to collect members' details and for using them only for the chama's business.
          </li>
        </UL>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 3 */
  {
    id: 'collect',
    title: 'What we collect',
    body: (
      <>
        <P>We collect only what {LEGAL.product} needs to work. Here is everything, by purpose.</P>
        <Table
          head={['Information', 'Details', 'Comes from']}
          rows={[
            [<strong key="1">Account &amp; sign-in</strong>, 'Name; mobile number; email address (if you use Google or email sign-in); a unique account ID; sign-in method. Passwords for email sign-in are handled by Google Firebase Authentication and are never visible to us.', 'You; Google (if you use Google sign-in)'],
            [<strong key="2">Member record</strong>, 'Full name; mobile number; National ID or passport number; join date; role (Chair, Treasurer, Secretary, member); status; running total contributed and credit balance; whether the member has opted in to messages; a display colour and initial.', 'The chama\'s officials, and you'],
            [<strong key="3">Money records</strong>, 'Contributions due and paid; loan applications, approvals, schedules and repayments; merry-go-round pots, queue order, payments, arrears, shortfalls, exits and payouts; a transaction ledger with amounts, fees and references; cash entries recorded by officials.', 'Officials, members, and Paystack (payment confirmations)'],
            [<strong key="4">Payment details</strong>, 'The phone number that receives the M-Pesa or Airtel prompt; payment references, amounts, status and time; the chama\'s settlement account (bank or till) and its Paystack codes. We never see or store your M-Pesa or Airtel PIN, card numbers or bank passwords.', 'You; the chama\'s Chair; Paystack'],
            [<strong key="5">Plan &amp; billing</strong>, 'The chama\'s plan, expiry date, SMS credit balance, report credits and purchase history.', 'The chama; Paystack'],
            [<strong key="6">Messages</strong>, 'The text of SMS sent through the app, who it was addressed to, how many were sent and credits used; scheduled reminders; the in-app message inbox. A security PIN SMS or sign-in code is sent but its PIN is not logged.', 'Officials'],
            [<strong key="7">Minutes &amp; reports</strong>, 'Meeting minutes text; generated reports (PDF/CSV) held in a private store and reachable only by short-lived links.', 'Officials; generated by us from the records'],
            [<strong key="8">WhatsApp assistant</strong>, 'Your WhatsApp phone number and the messages needed to run the chat; the step you are on; a log of actions (for security and support); counters used to stop abuse; and daily usage totals in which each user appears only as a salted, one-way code — never a phone number.', 'You, through WhatsApp'],
            [<strong key="9">Support</strong>, 'Support requests (subject, message, category, status and replies) and an audit trail of actions a desk takes in a chama (what was done, by which desk, and the outcome — not message text or ID numbers).', 'Officials; desks'],
            [<strong key="10">Technical</strong>, 'Device and browser type, IP address and error logs created when you use the app or functions; reCAPTCHA signals used by Google to stop automated sign-ins; data kept on your device (section 10).', 'Your device'],
          ]}
        />
        <H3>What we do not collect</H3>
        <UL>
          <li>Your location, camera, microphone, contacts or photos. (The app blocks them.)</li>
          <li>Card numbers, PINs, or bank or mobile-money passwords.</li>
          <li>Biometric data, or any information about your health, religion, politics, race or sexual life.</li>
          <li>Advertising IDs or tracking identifiers.</li>
        </UL>
        <Callout tone="important" title="About your ID number">
          Your National ID or passport number is personal information that deserves extra care. It is used to confirm who you are in your chama (for example, when you sign in through WhatsApp), to make sure one ID is not registered twice in a chama,
          and to match you to your chama membership in Samuhia Payments if you use it. It is shown masked in most screens. Only the chama's Chair and Treasurer, and you for your own record, can see the full number. We also keep a one-way coded form of it (a keyed hash) so it can be matched without exposing the number.
        </Callout>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 4 */
  {
    id: 'use',
    title: 'Why we use your information',
    body: (
      <>
        <Table
          head={['What we do', 'Information used', 'Our lawful basis']}
          rows={[
            ['Create and secure your account; sign you in; keep you signed in on your device', 'Account & sign-in, technical', 'Contract — to provide the service you asked for'],
            ['Keep the chama\'s members, contributions, loans, pots, minutes and reports', 'Member record, money records, minutes', 'Contract and the chama\'s instructions (we act as its processor)'],
            ['Take payments, apply them correctly and avoid double-charging', 'Payment details, money records', 'Contract; legal obligation (accounting and anti-fraud)'],
            ['Bill the chama for plans, SMS credits and reports', 'Plan & billing, payment details', 'Contract; legal obligation'],
            ['Send SMS and WhatsApp messages the service needs: sign-in codes, report PINs, plan reminders, and messages your officials send', 'Phone number, message text, member opt-in status', 'Contract; the chama\'s instructions; your consent for chama messages where required'],
            ['Check who you are (ID check, one ID per chama, WhatsApp verification) and stop fraud and abuse', 'Member record, WhatsApp data, technical', 'Legitimate interest in protecting members and the service; legal obligation'],
            ['Give support and help a chama through its desk', 'Support, relevant chama records', 'Contract; the chama\'s instructions'],
            ['Keep the service running, fix faults and plan capacity (using logs and counts that do not identify people)', 'Technical, daily usage totals', 'Legitimate interest'],
            ['Comply with law, a court order or a lawful request', 'Whatever the legal request covers', 'Legal obligation'],
          ]}
        />
        <H3>What we do not do</H3>
        <UL>
          <li>We do not sell, rent or trade personal data.</li>
          <li>We do not use it for advertising, marketing profiles, credit scoring or to train AI models.</li>
          <li>We do not send our own marketing SMS or WhatsApp messages. If that ever changes, we will ask for your consent first and you will be able to say no.</li>
          <li>We do not use it for any purpose that is incompatible with the ones above without telling you and, where required, asking for your consent.</li>
        </UL>
        <H3>Automated steps</H3>
        <P>
          Some features run automatically from payment records: contribution status (paid, partial, overdue), loan schedules, fee calculations, and — if a chama turns them on — the merry-go-round "smart" draw and
          late-payer protection, which can move a member's place in a queue. They apply rules the chama has chosen. They do not produce a legal effect by themselves, and you may ask an official or us for a human review of any result (section 11).
        </P>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 5 */
  {
    id: 'never-sold',
    title: 'We never sell or trade your data',
    body: (
      <>
        <P>
          We state it plainly because it matters: <strong>{LEGAL.product} does not sell personal data, and does not give it to third parties for their own purposes</strong>.
          There are no advertising partners, no data brokers and no analytics or tracking companies connected to the app.
        </P>
        <P>
          The only outside parties that handle data are the technology and payment providers we need in order to deliver the service. They act on our instructions, for that purpose only (section 6). Section 7 explains what other people in your chama can see.
        </P>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 6 */
  {
    id: 'providers',
    title: 'The providers that help us deliver the service',
    body: (
      <>
        <P>
          {LEGAL.product} is not built from advertising or marketing services. But no software runs alone, so these providers process data for us, and only what is needed for their task:
        </P>
        <Table
          head={['Provider', 'What it does for you', 'What it receives']}
          rows={[
            [<strong key="g">Google (Firebase / Google Cloud)</strong>, 'Hosts the app and database, runs our server code, stores report files, signs you in (phone codes, Google sign-in, email and password), delivers one-time codes by SMS, and blocks automated sign-ins with reCAPTCHA.', 'Everything stored in the service, in encrypted form, plus the sign-in details and device signals needed for sign-in.'],
            [<strong key="gf">Google Fonts</strong>, 'Serves the typefaces used on screen.', 'Your IP address and browser details when a page loads.'],
            [<strong key="p">Paystack</strong>, 'Processes M-Pesa, Airtel Money and bank payments and settles them to the chama\'s account. For a payment it is also an independent controller under its own privacy notice.', 'The payer\'s phone number, amount, payment reference, the chama\'s settlement account codes, and a placeholder email we generate (it is not a real address).'],
            [<strong key="s">Our SMS provider (HostPinnacle)</strong>, 'Delivers SMS from the sender name SAMUHIA over mobile networks.', 'The recipient\'s phone number and the message text.'],
            [<strong key="w">WhatsApp (Meta)</strong>, 'Carries the WhatsApp assistant conversation.', 'The messages and phone number of the people chatting with the assistant, under Meta\'s terms.'],
            [<strong key="m">Mobile networks and banks</strong>, 'Carry SMS and move money.', 'Whatever is needed to deliver the SMS or complete the transaction.'],
          ]}
        />
        <H3>Our own connected products</H3>
        <UL>
          <li><strong>Samuhia Desk</strong> (support desks). A desk can reach a chama\'s records through limited functions to help with setup, imports, SMS and reports, and each action is logged. Access is one-way. The company desk is always connected; the chama chooses any others.</li>
          <li><strong>Samuhia Payments.</strong> If you use it too, it can match you to your chama memberships using your ID number and a verified phone, so you can see and pay your chama dues. It reads chama data; it does not change records.</li>
        </UL>
        <H3>Other disclosures</H3>
        <UL>
          <li><strong>By law.</strong> If a court, regulator or authority lawfully requires it, or to prevent serious fraud or harm. We will tell the affected chama where the law lets us.</li>
          <li><strong>If the business changes.</strong> If {LEGAL.company} merges or transfers the business, the successor must honour this policy and we will tell you.</li>
        </UL>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 7 */
  {
    id: 'inside-chama',
    title: 'Who inside your chama can see what',
    body: (
      <>
        <Table
          head={['Role', 'What they can see']}
          rows={[
            [<strong key="m">Member</strong>, 'Their own profile, full ID number, contributions, loans, pots and statements; the chama\'s name, public settings and member list with masked ID details; messages addressed to them; minutes.'],
            [<strong key="s">Secretary</strong>, 'Member list (ID masked), minutes and communications, and chama records the secretary role allows.'],
            [<strong key="t">Treasurer and Chair (finance admins)</strong>, 'All of the above plus every member\'s full ID number and phone, all contributions, loans, pots, transactions, settlement details, SMS logs, reports and billing. The Chair also manages plan and settlement.'],
            [<strong key="d">A support desk</strong>, 'Only what its limited functions allow, only for chamas that it is connected to (or the company desk), and logged.'],
          ]}
        />
        <P>
          These limits are enforced on our servers and in our database rules, not just on screen, and an official's access changes as soon as their role changes. People outside your chama cannot see your chama's records.
          Remember that an official or member can also copy or share what they can see, which is beyond our control; this is why chamas should only hold the details they need.
        </P>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 8 */
  {
    id: 'transfers',
    title: 'Where your data is stored and international transfers',
    body: (
      <>
        <P>
          Our systems run on Google Cloud. The database is held in Google's North America region, and our server functions run in Google's Johannesburg (South Africa) and United States regions. Google, Paystack, our SMS provider and Meta may also process data in other countries.
          So your information can be transferred and stored outside Kenya.
        </P>
        <P>
          When data leaves Kenya, we rely on providers that apply strong security and contractual protection for personal data, as the Data Protection Act requires, and we send them only what they need. By using {LEGAL.product} you accept these transfers; if you object, please write to <Mail />.
        </P>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 9 */
  {
    id: 'security',
    title: 'How we keep it safe',
    body: (
      <>
        <UL>
          <li><strong>Encryption.</strong> Data is encrypted in transit (HTTPS) and at rest by our hosting provider.</li>
          <li><strong>Role checks on the server.</strong> Every sensitive action re-checks your role on our servers, independently of what the app shows. Database rules block direct access to other chamas' data.</li>
          <li><strong>Protected ID numbers.</strong> Full ID numbers are visible only to finance admins and to the member; elsewhere they are masked. A keyed one-way code is used for matching, with its secret kept in a managed secrets vault.</li>
          <li><strong>Secrets and files.</strong> API keys are held in a secrets vault, not in code. The file store cannot be read directly from a browser; reports are issued through links that expire after {LEGAL.reportLinkHours} hours, and the most sensitive reports are PIN-protected.</li>
          <li><strong>Payments.</strong> We never handle your PIN. Each payment has a unique reference that prevents double processing, and money only counts once Paystack confirms it.</li>
          <li><strong>WhatsApp assistant.</strong> Identity checks, re-verification after {mins(SECURITY.REAUTH_AFTER_SECONDS)} minutes of inactivity, a {mins(SECURITY.AUTH_LOCKOUT_SECONDS)}-minute lock after {SECURITY.MAX_AUTH_ATTEMPTS} wrong attempts, and rate limits.</li>
          <li><strong>Audit trails.</strong> Money entries are permanent and desk actions are logged.</li>
        </UL>
        <P>
          No system is perfectly secure. You help by guarding your phone and codes, signing out on shared devices, and never sharing your PIN, one-time codes or ID number with anyone claiming to be us.
        </P>
        <H3>If something goes wrong</H3>
        <P>
          If a breach is likely to harm you, we will notify the Office of the Data Protection Commissioner within 72 hours of becoming aware of it, tell affected people without unreasonable delay, and explain what happened and what to do.
        </P>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 10 */
  {
    id: 'device',
    title: 'Cookies and data on your device',
    body: (
      <>
        <P>{LEGAL.product} sets <strong>no advertising or tracking cookies</strong>. It keeps a few things on your device only to work:</P>
        <UL>
          <li><strong>Your sign-in session</strong>, so you do not need a new SMS code on every visit. Signing out removes it.</li>
          <li><strong>The offline queue and a local copy of your chama's data</strong>, so the app keeps working with no signal and syncs when you reconnect. Anything not yet synced lives only on your device until it does.</li>
          <li><strong>App files (service worker and cache)</strong>, and your choices about the install prompt.</li>
        </UL>
        <P>You can clear all of this in your browser settings. Doing so signs you out and removes unsynced changes.</P>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 11 */
  {
    id: 'rights',
    title: 'Your rights',
    body: (
      <>
        <P>Under the Data Protection Act, 2019, you have the right to:</P>
        <UL>
          <li><strong>be informed</strong> about how your data is used (this policy);</li>
          <li><strong>access</strong> your personal data and get a copy;</li>
          <li><strong>correct</strong> information that is wrong or out of date;</li>
          <li><strong>delete</strong> your data, where it is no longer needed or was collected without a lawful basis;</li>
          <li><strong>object</strong> to processing and <strong>withdraw consent</strong> you gave (this does not undo what was lawfully done before);</li>
          <li><strong>move</strong> your data (a portable copy) where it applies; and</li>
          <li><strong>ask for human review</strong> of an automated result that affects you (section 4).</li>
        </UL>
        <H3>How to use them</H3>
        <UL>
          <li>For records about your membership — contributions, loans, pots — ask your chama's officials first; they control that data and can correct it in the app. You can also write to us.</li>
          <li>For anything else, write to <Mail /> from the phone number or email linked to your account, or give us enough to confirm you are who you say. We aim to answer within {LEGAL.privacyRequestDays} days.</li>
          <li>To stop SMS from your chama, tell an official or write to us and we will mark you as opted out.</li>
        </UL>
        <H3>Limits you should know about</H3>
        <UL>
          <li>Money ledgers must stay complete. We keep financial records for the period in section 12 even if you leave, because other members' records depend on them and the law may require it. We can limit access to your contact details and remove what is not needed.</li>
          <li>We cannot give you other people's data, or release data where that would harm someone else or the law forbids it.</li>
        </UL>
        <H3>If you are not satisfied</H3>
        <P>
          Please contact us first and we will try to put it right. You may also complain to the <strong>Office of the Data Protection Commissioner of Kenya</strong> (odpc.go.ke). Your rights under Kenyan law are not affected by anything in this policy.
        </P>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 12 */
  {
    id: 'retention',
    title: 'How long we keep data',
    body: (
      <>
        <Table
          head={['Data', 'How long']}
          rows={[
            ['Account and member records', 'While the account or chama is active. If a member is removed, the record is marked removed and no longer counted, but is not erased because other members\' histories depend on it.'],
            ['Financial records and the transaction ledger', `For as long as the chama exists and for up to ${LEGAL.financialRecordRetentionYears} years afterwards, for accounting, tax and dispute purposes.`],
            ['SMS log, support requests, minutes', 'While the chama is active, then with the financial records unless the chama asks us to delete them and the law allows.'],
            ['Generated report files', `Held in a private store; download links expire after ${LEGAL.reportLinkHours} hours.`],
            ['WhatsApp audit log, rate-limit counters and similar technical logs', `Deleted automatically after about ${LEGAL.technicalLogRetentionDays} days.`],
            ['Device data (session, offline copy)', 'Until you sign out or clear your browser data.'],
          ]}
        />
        <P>When data is no longer needed, we delete or anonymise it.</P>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 13 */
  {
    id: 'children',
    title: 'Children',
    body: (
      <P>
        {LEGAL.product} is for people aged 18 and over and is not directed at children. If you believe a child's data has been entered, write to <Mail /> and we will remove it.
      </P>
    ),
  },

  /* ------------------------------------------------------------------ 14 */
  {
    id: 'sms-whatsapp',
    title: 'SMS and WhatsApp messages',
    body: (
      <UL>
        <li>You may receive an SMS from the sender name <strong>{LEGAL.smsSenderName}</strong> because (a) you signed in or asked for a code or PIN, (b) your chama's officials sent a reminder or announcement, or (c) you are the chair or treasurer and your plan is about to expire.</li>
        <li>Those messages go through our SMS provider and mobile networks. Your phone number and the message text are shared with them for delivery only.</li>
        <li>We do not send promotional messages from {LEGAL.brand}. To stop a chama's messages, see section 11.</li>
        <li>On WhatsApp, the assistant only answers when you message it.</li>
      </UL>
    ),
  },

  /* ------------------------------------------------------------------ 15 */
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: (
      <P>
        We will update this policy when we add features, change providers or the law changes. The version and date at the top show when it last changed. For a change that matters (for example, a new type of provider or purpose), we will tell you in the app or by SMS before it takes effect.
        The <TermsLink /> also apply.
      </P>
    ),
  },

  /* ------------------------------------------------------------------ 16 */
  {
    id: 'contact',
    title: 'Contact us',
    body: (
      <P>
        <strong>{LEGAL.company}</strong> — Data protection contact<br />
        {LEGAL.place}<br />
        Email: <Mail />
      </P>
    ),
  },
];

export default function PrivacyPage() {
  useSeo({
    title: `Privacy Policy | ${LEGAL.product} by ${LEGAL.brand}`,
    description: `How ${LEGAL.product} collects, uses and protects your data. We never sell it: it is used only to deliver the service, with a short, named list of providers.`,
    path: LEGAL_PATHS.privacy,
  });
  return (
    <LegalLayout
      title="Privacy Policy"
      sections={sections}
      other={{ to: LEGAL_PATHS.terms, label: 'Read the Terms & Conditions' }}
      intro={
        <P>
          Your chama's records are personal and so is your money. This policy tells you exactly what {LEGAL.product} collects, what it is used for, who else touches it, and what you can do about it.
        </P>
      }
    />
  );
}
