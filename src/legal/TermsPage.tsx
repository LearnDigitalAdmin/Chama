import { useSeo } from '../seo/useSeo';
import { FEES, PLANS, PLAN_ORDER, REPORT_WALLET_CREDIT_PRICE_KES, SECURITY } from '../lib/constants';
import { MAX_SMS_LENGTH, MAX_SMS_SEGMENTS, SMS_SEGMENT_BREAKPOINTS } from '../lib/smsValidation';
import LegalLayout, { Callout, H3, Mail, P, PrivacyLink, Table, UL, type LegalSection } from './LegalLayout';
import { LEGAL, LEGAL_PATHS } from './legalConfig';

const kes = (n: number) => 'KES ' + n.toLocaleString('en-KE');
const pct = (r: number) => `${+(r * 100).toFixed(2)}%`;
const mins = (s: number) => Math.round(s / 60);

const PAID_PLANS = PLAN_ORDER.filter((p) => PLANS[p].price > 0);

const sections: LegalSection[] = [
  /* ------------------------------------------------------------------ 1 */
  {
    id: 'about',
    title: 'Who we are and what these terms cover',
    body: (
      <>
        <P>
          {LEGAL.product} is operated by <strong>{LEGAL.company}</strong>, a business registered in Kenya and operating from {LEGAL.place}
          {' '}("<strong>{LEGAL.brand}</strong>", "<strong>we</strong>", "<strong>us</strong>"). These Terms &amp; Conditions
          ("<strong>Terms</strong>") are the agreement between {LEGAL.brand} and every person who uses {LEGAL.product} —
          through the web app, the installable app (PWA), the WhatsApp assistant, SMS messages we send, or a {LEGAL.brand} support desk.
        </P>
        <P>
          By creating an account, signing in, being added to a chama, paying through {LEGAL.product}, or otherwise using it, you agree to
          these Terms and to our <PrivacyLink />. If you do not agree, please do not use {LEGAL.product}.
        </P>
        <Callout title="The short version">
          <UL>
            <li>{LEGAL.product} is record-keeping and collection software for chamas. It is <strong>not a bank, SACCO, lender, insurer or financial adviser</strong>, and it <strong>does not hold your chama's money</strong>.</li>
            <li>Your chama's officials run the chama. Money rules, loan decisions, penalties and disputes are between the members of the chama — not {LEGAL.brand}.</li>
            <li>Online payments are processed by Paystack and settle to your chama's own bank account or till. A small fee is shown to the payer before they confirm.</li>
            <li>SMS is sold in credits, sent from the name <strong>{LEGAL.smsSenderName}</strong>, and the chama's officials are responsible for what they send.</li>
            <li>We use your data only to run the service. We never sell it (see the <PrivacyLink />).</li>
          </UL>
        </Callout>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 2 */
  {
    id: 'definitions',
    title: 'Words we use',
    body: (
      <Table
        head={['Term', 'Meaning']}
        rows={[
          [<strong key="a">Chama</strong>, 'A group of people who save, lend or rotate money together and have set it up in MyChama.'],
          [<strong key="b">Official</strong>, 'A member holding the role of Chair, Treasurer or Secretary. Chair and Treasurer are "finance admins".'],
          [<strong key="c">Member</strong>, 'Anyone recorded in a chama\'s member list, including officials.'],
          [<strong key="d">Plan</strong>, 'The subscription tier of a chama: Free, Starter, Basic, Growth or Max.'],
          [<strong key="e">WhatsApp assistant</strong>, 'The member-facing chat assistant on WhatsApp that lets members check balances and pay.'],
          [<strong key="f">SMS credits</strong>, 'Prepaid units a chama buys to send SMS from MyChama.'],
          [<strong key="g">Desk</strong>, `A ${LEGAL.brand} support desk (the company desk, or an agent a chama connects) that helps a chama with setup, imports, SMS and reports.`],
          [<strong key="h">Paystack</strong>, 'The licensed payment processor that handles M-Pesa, Airtel Money and bank collections for MyChama.'],
          [<strong key="i">Samuhia Payments</strong>, `${LEGAL.brand}'s separate payments product, which can link to your chama memberships (section 12).`],
        ]}
      />
    ),
  },

  /* ------------------------------------------------------------------ 3 */
  {
    id: 'what-it-is',
    title: 'What MyChama is — and is not',
    body: (
      <>
        <P>{LEGAL.product} helps a chama keep its records (members, contributions, loans, merry-go-round pots, minutes), collect money online, send SMS, and produce reports.</P>
        <H3>We do not hold or move your chama's money</H3>
        <P>
          Online collections are charged by Paystack and settle directly to the bank account or till your chama's Chair registered.
          {' '}{LEGAL.product} keeps the <em>records</em> of who paid and what is owed. {LEGAL.brand} does not keep a wallet, pool or balance of chama funds,
          pays no interest on anything, and does not pay out loans or merry-go-round payouts. Those are handed over by your officials and
          then recorded in {LEGAL.product}.
        </P>
        <H3>We are not a financial institution</H3>
        <UL>
          <li>We are not a bank, deposit-taker, SACCO, microfinance institution, insurer, investment adviser or money-lender, and nothing in {LEGAL.product} is financial, legal, tax or accounting advice.</li>
          <li>We do not lend. Any loan is a loan <em>from your chama to a member</em>, on terms the chama sets.</li>
          <li>We do not register chamas or make a chama a legal entity. Whether and how your chama is registered, and any licences or tax obligations it has, are the chama's own responsibility.</li>
          <li>We do not credit-check members, guarantee repayment, or collect debts.</li>
        </UL>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 4 */
  {
    id: 'accounts',
    title: 'Accounts, sign-in and eligibility',
    body: (
      <>
        <UL>
          <li><strong>Age.</strong> You must be 18 or older. {LEGAL.product} is not for children.</li>
          <li><strong>Sign-in methods.</strong> Members sign in with a Kenyan phone number and an SMS one-time code. Anyone can also use Google sign-in. Admins creating a chama can use an email address and password, and must verify that email first.</li>
          <li><strong>Accurate details.</strong> You must give true information — your name, phone number and, where asked, your National ID or passport number — and keep it current. A chama's officials are responsible for the accuracy of the details they enter about other members.</li>
          <li><strong>One person, one identity.</strong> An ID or passport number can be registered only once per chama. You must not register or use another person's identity or phone number without their permission.</li>
          <li><strong>Keep access safe.</strong> You are responsible for your phone, your SMS codes, your password and anything done from your signed-in device. For convenience, a signed-in session stays active on your device until you sign out — sign out on any shared or borrowed device. Tell us promptly if you think someone else has access.</li>
          <li><strong>Roles are checked on our servers.</strong> What you can do depends on your role in each chama. If an official changes your role or status, your access changes straight away.</li>
        </UL>
        <P>We may refuse, limit or close an account that is unlawful, abusive, fraudulent, or in breach of these Terms (see section 22).</P>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 5 */
  {
    id: 'responsibilities',
    title: 'Who is responsible for what',
    body: (
      <>
        <H3>What {LEGAL.brand} is responsible for</H3>
        <UL>
          <li>Providing {LEGAL.product} with reasonable skill and care, and keeping the records you enter safe (see the <PrivacyLink />).</li>
          <li>Calculating fees, loan schedules, contribution status and reports from the information in the system, and showing the payer any fee before they pay.</li>
          <li>Enforcing roles, plan limits and security checks on our servers.</li>
        </UL>
        <H3>What a chama and its officials are responsible for</H3>
        <UL>
          <li>The chama's constitution, rules, contribution amounts, loan products and rates, penalties, merry-go-round rules and every decision made under them.</li>
          <li>Entering accurate information and recording cash and payouts honestly and promptly.</li>
          <li>Having the right to collect and store the personal details of members (including ID numbers) and telling members how they are used. Officials act for the chama; for member records they enter, the chama decides the purpose and {LEGAL.brand} processes the data on its behalf (see the <PrivacyLink />).</li>
          <li>The chama's SMS content and audiences (section 10), its bank or till details, and its own accounts and tax affairs.</li>
          <li>Resolving disputes between members, and between members and officials.</li>
        </UL>
        <H3>What every member is responsible for</H3>
        <UL>
          <li>Paying what they have agreed to pay, on time, to the chama.</li>
          <li>Checking the phone number and amount before confirming a payment prompt, and entering their M-Pesa or Airtel PIN only on their own phone. We never see or ask for your PIN.</li>
          <li>Telling an official or us quickly about any record that looks wrong.</li>
        </UL>
        <Callout tone="important" title="Officials hold real power">
          Chair and Treasurer can record cash, approve loans, change settings and see member ID details. {LEGAL.brand} gives the tools (for example, both the Chair and the Treasurer must approve a loan, and a settlement-account change must be approved by a different official) but cannot supervise how officials behave. If you are a member, choose your officials carefully.
        </Callout>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 6 */
  {
    id: 'plans',
    title: 'Plans, prices and billing',
    body: (
      <>
        <P>Every chama starts on the Free plan. The Chair can upgrade. Prices are in Kenya Shillings per month, and any taxes that apply are charged as the law requires.</P>
        <Table
          head={['Plan', 'Price / month', 'Member limit', 'Online collection', 'Standard report credits / month', 'Premium report credits / month']}
          rows={PLAN_ORDER.map((p) => [
            <strong key={p}>{PLANS[p].name}</strong>,
            PLANS[p].price === 0 ? 'Free' : kes(PLANS[p].price),
            PLANS[p].memberLimit >= 999 ? 'Very high (999)' : String(PLANS[p].memberLimit),
            PLANS[p].onlineCollection ? 'Yes' : 'No — cash records only',
            PLANS[p].standardReportCredits === null ? 'Unlimited' : String(PLANS[p].standardReportCredits),
            String(PLANS[p].premiumReportCredits),
          ])}
        />
        <UL>
          <li><strong>How you pay.</strong> The Chair pays for a plan by an M-Pesa or Airtel Money prompt on their phone (processed by Paystack). The plan starts when Paystack confirms the payment — not when the prompt is sent.</li>
          <li><strong>No automatic charging.</strong> We cannot silently charge a mobile-money account. "Remind me to renew" only sends a reminder SMS a few days before expiry.</li>
          <li><strong>Expiry.</strong> If a paid plan is not renewed by its expiry date, the chama moves to the Free plan automatically. Your records stay, but Free-plan limits apply until you upgrade again.</li>
          <li><strong>Downgrades.</strong> Changing to a cheaper plan takes effect immediately, there is no refund for unused time, and it is blocked if the chama has more active members than the new plan allows.</li>
          <li><strong>Price changes.</strong> We may change prices or plan limits. A change applies from the next time you buy or renew, and we will show the new price in the app before you pay.</li>
          <li><strong>Refunds.</strong> Plan fees, SMS credits and report credits are not refundable once they are credited, except where we charged you in error, charged twice for one purchase, or the law requires a refund. Write to <Mail /> with the payment reference.</li>
        </UL>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 7 */
  {
    id: 'payments',
    title: 'Payments, fees and settlement',
    body: (
      <>
        <H3>How an online payment works</H3>
        <UL>
          <li>A member (or an official on their behalf) chooses what to pay — a contribution, a loan repayment or a merry-go-round contribution — and the amount.</li>
          <li>{LEGAL.product} shows the <strong>total to be charged</strong> and the fees inside it <strong>before</strong> the payer confirms.</li>
          <li>Paystack sends an M-Pesa or Airtel Money prompt to the phone number entered. The payer approves it with their PIN. A prompt expires after {mins(SECURITY.PAYMENT_INTENT_TTL_SECONDS)} minutes.</li>
          <li>The payment only counts when Paystack confirms it to us. Each payment has a unique reference, so a repeated confirmation can never be applied twice.</li>
          <li>For safety, no more than {SECURITY.MAX_INTENTS_PER_HOUR} payment attempts can be started per hour.</li>
        </UL>
        <H3>Fees</H3>
        <P>
          The payer pays the fees <em>on top of</em> the amount owed, so the chama receives exactly the amount recorded. The charge is the amount owed plus two parts:
        </P>
        <UL>
          <li><strong>Paystack's processing fee</strong> — currently {pct(FEES.PAYSTACK_FEE_RATE)} of the charge, capped at {kes(FEES.PAYSTACK_FEE_CAP)} per transaction.</li>
          <li><strong>{LEGAL.product} service fee</strong> — {pct(FEES.CONTRIBUTION_MARKUP_RATE)} on contributions and merry-go-round contributions; on loan repayments it depends on the chama's plan:</li>
        </UL>
        <Table
          head={['Plan', 'Service fee on loan repayments']}
          rows={PAID_PLANS.map((p) => [PLANS[p].name, FEES.LOAN_MARKUP_RATE[p] === null ? 'None' : pct(FEES.LOAN_MARKUP_RATE[p] as number)])}
        />
        <P>
          Paystack may change its own pricing; where it does, the amount shown to the payer before they confirm is the amount that applies. Your mobile-money provider or bank
          may also charge its own fees, which we do not control.
        </P>
        <H3>Settlement to the chama</H3>
        <UL>
          <li>The Chair sets a settlement account — a bank account or an M-Pesa Till. (M-Pesa Paybill is not currently accepted.) Online collections cannot be taken until this is done.</li>
          <li>Paystack pays collections into that account on the schedule Paystack and the chama's settings provide. Timing depends on Paystack and the receiving bank or mobile-money operator.</li>
          <li>Changing the settlement account needs a request by one official and approval by a <em>different</em> official. Wrong account details given by the chama are the chama's responsibility.</li>
        </UL>
        <H3>Cash and payouts</H3>
        <P>
          Officials can record cash received, loans handed out and merry-go-round payouts. Those entries are the chama's own statements and {LEGAL.brand} cannot verify that cash actually changed hands.
          Recorded money entries are permanent; if a mistake is made it is corrected by a new, visible entry, not by erasing the old one.
        </P>
        <H3>Mistakes, disputes and refunds of chama money</H3>
        <UL>
          <li>Because we do not hold chama funds, we <strong>cannot refund a contribution or repayment</strong>. Money is returned, if at all, by the chama from its own account, under its own rules.</li>
          <li>If you paid the wrong amount or typed the wrong phone number, tell an official and write to <Mail /> with the reference. We will help trace the payment but cannot reverse a completed mobile-money transaction ourselves.</li>
          <li>If a payment succeeds at Paystack but is not reflected in the chama's records, we will reconcile it from the payment reference.</li>
          <li>Paystack's and your provider's own terms and dispute processes also apply to the underlying transaction.</li>
        </UL>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 8 */
  {
    id: 'loans',
    title: 'Loans between chama members',
    body: (
      <>
        <UL>
          <li>Loan products (flat-rate or reducing-balance), rates, limits and terms are set by the chama. {LEGAL.product} turns them into a repayment schedule as a calculation aid; the chama's rules and the members' agreement are what bind the borrower.</li>
          <li>A loan application needs approval from <strong>both</strong> the Chair and the Treasurer before it can be marked as handed out.</li>
          <li>Marking a loan as disbursed records that the chama gave the money. {LEGAL.brand} does not pay it out.</li>
          <li>Late payments, penalties, guarantors, security and recovery are matters for the chama. {LEGAL.brand} is not a party to any loan and is not responsible if a borrower does not repay.</li>
          <li>A member cannot be permanently removed while they have an unsettled loan or belong to an unfinished merry-go-round pot.</li>
        </UL>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 9 */
  {
    id: 'mgr',
    title: 'Merry-go-round (table banking) pots',
    body: (
      <>
        <UL>
          <li>A pot is a voluntary arrangement among its members. Each member agrees to the contribution amount, frequency and rules the chama sets for it.</li>
          <li>The order of payouts can be set by a random draw or a "smart" draw. If the chama turns on <strong>late-payer protection</strong>, a member's place in the queue can move back automatically based on their payment record. These are automated steps configured by the chama; ask an official if you want a decision reviewed.</li>
          <li>The chama chooses how a final or uneven round is handled, and whether a departing member forfeits a percentage of their refund. Those settings are shown in the pot and are agreed between members, not set by us.</li>
          <li>Arrears, shortfalls and exits are tracked in a pot ledger. Payouts are handed over by officials and recorded in {LEGAL.product}; {LEGAL.brand} does not pay them.</li>
          <li>Taking part in a pot carries the risk that another member stops paying. {LEGAL.brand} does not guarantee that anyone will pay, or will be paid.</li>
        </UL>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 10 */
  {
    id: 'sms',
    title: 'SMS messages and SMS credits',
    body: (
      <>
        <H3>What we send</H3>
        <UL>
          <li><strong>Chama messages</strong> — announcements and reminders that officials choose to send to members (once, or on a daily, weekly or monthly schedule).</li>
          <li><strong>Service messages</strong> — sign-in codes, report PINs, and plan expiry or renewal reminders. These are part of running your account and do not use SMS credits.</li>
        </UL>
        <P>
          Every message from {LEGAL.product}, for every chama, is sent under the single registered sender name <strong>{LEGAL.smsSenderName}</strong>, through our SMS provider.
          Each message starts with "Dear [first name]," and ends with the chama's name, and those words count towards its length and cost.
        </P>
        <H3>Credits and cost</H3>
        <UL>
          <li>SMS is prepaid. The Chair or an official tops up credits by M-Pesa or Airtel Money through Paystack; the credit price and the number of credits you receive are shown before you pay.</li>
          <li>One credit pays for one SMS segment to one recipient, on every plan. A message of up to {SMS_SEGMENT_BREAKPOINTS[0]} characters is 1 segment, up to {SMS_SEGMENT_BREAKPOINTS[1]} is 2, and up to {SMS_SEGMENT_BREAKPOINTS[2]} is 3. Messages longer than {MAX_SMS_LENGTH} characters ({MAX_SMS_SEGMENTS} segments) are not sent.</li>
          <li>Credits are deducted for messages we hand to the SMS network. A message that fails at our end is not charged. Delivery is not guaranteed, and a message already handed to the network is charged even if the phone is off, out of coverage, blocked or on a network that does not deliver it.</li>
          <li>Credits belong to one chama, cannot be transferred, withdrawn or exchanged for money, and are non-refundable except as in section 6.</li>
        </UL>
        <H3>Rules for the content</H3>
        <UL>
          <li>Only letters, numbers and standard punctuation are allowed — no emoji or special characters. The only links allowed are WhatsApp links.</li>
          <li>Messages may be sent <strong>only to the chama's own members</strong>, about the chama's business. No spam, advertising for third parties, political campaigning, harassment, threats, shaming of members, misleading or fraudulent messages, or anything unlawful.</li>
          <li>The official who sends a message, and the chama, are responsible for its content and for having a proper basis to contact each recipient. Members who have opted out of messages are skipped automatically; a member who wants to opt out can tell an official or write to <Mail />.</li>
          <li>Sending must follow Kenyan law, including rules of the Communications Authority of Kenya and mobile network operators.</li>
        </UL>
        <P>We keep a log of messages sent (see the <PrivacyLink />), and may stop a sender who breaks these rules.</P>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 11 */
  {
    id: 'whatsapp',
    title: 'The WhatsApp assistant',
    body: (
      <>
        <UL>
          <li>The assistant lets a member check their own records and pay by following the chat. It treats <strong>everyone as an ordinary member</strong>, including officials; officials' powers are in the app only.</li>
          <li>To protect you, it verifies who you are against the chama's records (for example with your ID details), asks you to verify again after {mins(SECURITY.REAUTH_AFTER_SECONDS)} minutes of inactivity, and locks for {mins(SECURITY.AUTH_LOCKOUT_SECONDS)} minutes after {SECURITY.MAX_AUTH_ATTEMPTS} failed attempts.</li>
          <li>Never share your ID number, one-time codes or PIN with anyone claiming to be us. We will never ask for your M-Pesa or Airtel PIN.</li>
          <li>WhatsApp is run by Meta. Its terms and privacy practices apply to your use of WhatsApp itself, and the assistant is only as available as WhatsApp is.</li>
          <li>Payments from WhatsApp follow section 7 in full.</li>
        </UL>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 12 */
  {
    id: 'desk',
    title: 'Support desks and Samuhia Payments',
    body: (
      <>
        <H3>Support desks</H3>
        <UL>
          <li>{LEGAL.brand}'s own desk (code COG-0000) is always connected to every chama. A chama can also connect other desk agents by their code (up to 5), and the Chair or Treasurer can disconnect them.</li>
          <li>A desk can help with setup, member imports, SMS, payments questions and reports, and receives the support requests a chama submits. It can act inside a chama only through limited functions we provide, and each action is logged.</li>
          <li>Desk access is one-way: a desk can reach a chama's records to help; {LEGAL.product} never gives a desk the chama's credentials.</li>
          <li>Where a chama is looked after by a desk agent, the agent may earn a commission from {LEGAL.brand} on the plan, SMS and report charges we receive. It is paid out of our share and does not increase what you pay, and no commission is taken from contributions, loan repayments or merry-go-round money.</li>
          <li>You may ask a desk to do only things the chama is entitled to do. Instructions you give to a desk are treated as the chama's own.</li>
        </UL>
        <H3>Samuhia Payments</H3>
        <P>
          If you also use Samuhia Payments (for example as a landlord or tenant), it can match you to your chama memberships using your National ID or passport number together with a verified phone number, and show your chama balances and let you pay chama dues there.
          This is read-only from the chama's side and never touches rental data. Samuhia Payments' own terms apply to its features.
        </P>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 13 */
  {
    id: 'reports',
    title: 'Reports and exports',
    body: (
      <>
        <UL>
          <li>Standard reports (member statement, contribution ledger, arrears and penalties, minutes) and premium reports (cashflow, profit &amp; loss, balance sheet) use report credits. Credits included each month depend on the plan; extra credits can be bought, starting at {kes(REPORT_WALLET_CREDIT_PRICE_KES)} per credit, with cheaper bundles shown in the app. The Free plan has no PDF or Excel export. A member's own statement is free on every plan.</li>
          <li>Some reports are always protected with a 6-digit PIN that we SMS to the chair and treasurer (or to the member, for their own statement). Download links expire after {LEGAL.reportLinkHours} hours. CSV files cannot be PIN-protected.</li>
          <li>Reports are generated from the entries made in {LEGAL.product}. They are <strong>management reports, not audited financial statements</strong>, and are only as accurate as the records behind them. Use a qualified accountant for audits, tax returns and regulatory filings.</li>
          <li>Anyone you give a report or its PIN to can read it. Share reports carefully, because they contain members' personal and money information.</li>
        </UL>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 14 */
  {
    id: 'content',
    title: 'Your records and what we may do with them',
    body: (
      <>
        <UL>
          <li><strong>The chama's data stays the chama's.</strong> We do not claim ownership of the records, minutes, messages or documents you put into {LEGAL.product}.</li>
          <li>You give us permission to store, process, display and transmit that data, and to produce reports from it, as needed to run the service for you — and for no other purpose.</li>
          <li>Money entries and ledgers are kept as a permanent trail. Members are marked removed or inactive rather than deleted so that other people's histories stay accurate.</li>
          <li>You are responsible for lawful content: no unlawful, defamatory, fraudulent or infringing material.</li>
          <li>You can export your chama's records on the plans that allow exports. Do this before closing a chama or letting a plan lapse.</li>
        </UL>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 15 */
  {
    id: 'acceptable-use',
    title: 'Acceptable use',
    body: (
      <>
        <P>You must not use {LEGAL.product} to:</P>
        <UL>
          <li>run an unlawful scheme, including a pyramid, Ponzi or other deceptive scheme, or to take deposits from the public;</li>
          <li>launder money, finance crime or terrorism, or breach sanctions;</li>
          <li>commit fraud, impersonate anyone, or use someone's ID, phone or payment details without permission;</li>
          <li>send spam or abusive, threatening or misleading messages;</li>
          <li>get around limits, plan checks, rate limits or security measures, probe or attack the service, scrape it, or overload it;</li>
          <li>copy, reverse-engineer or resell {LEGAL.product}, or its SMS sender name, without our written permission; or</li>
          <li>do anything else that breaks Kenyan law or harms other people.</li>
        </UL>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 16 */
  {
    id: 'availability',
    title: 'Availability, offline use and changes to the service',
    body: (
      <>
        <UL>
          <li>{LEGAL.product} is built to keep working offline. Changes made without a connection are saved on your device and sent when you are online again. Until they sync they are not recorded on our servers, other people will not see them, and clearing your browser data or losing the device may lose them. Sending SMS, paying online, reports and plan changes always need a connection.</li>
          <li>We aim for reliable service but do not promise it will always be available or error-free. Maintenance, network problems, and outages at our providers (Google, Paystack, our SMS provider, Meta/WhatsApp, mobile networks) can interrupt it.</li>
          <li>We may improve, change or remove features. If a change materially reduces what a paid plan offers, we will tell you in advance.</li>
        </UL>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 17 */
  {
    id: 'ip',
    title: 'Our intellectual property',
    body: (
      <P>
        {LEGAL.product}, {LEGAL.brand}, {LEGAL.smsSenderName}, the logos, software, design and content of the service belong to {LEGAL.company} or its licensors.
        You get a personal, non-exclusive, non-transferable right to use {LEGAL.product} for your chama's lawful purposes while these Terms apply. "My Chama" is a brand name.
      </P>
    ),
  },

  /* ------------------------------------------------------------------ 18 */
  {
    id: 'disclaimers',
    title: 'Disclaimers',
    body: (
      <>
        <P>To the fullest extent the law allows:</P>
        <UL>
          <li>{LEGAL.product} is provided "as is" and "as available". We do not promise it will meet every need or be uninterrupted.</li>
          <li>Calculations, schedules, draws and reports are tools. Check them against your chama's rules before relying on them.</li>
          <li>We do not guarantee that any member will pay, that any loan will be repaid, that any merry-go-round payout will be made, or that any SMS will arrive.</li>
          <li>We are not responsible for what Paystack, your bank, your mobile-money provider, WhatsApp, or any other third party does or fails to do.</li>
        </UL>
        <P>Nothing here limits rights you have under Kenyan consumer-protection law that cannot be excluded.</P>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 19 */
  {
    id: 'liability',
    title: 'Limits on our liability',
    body: (
      <>
        <UL>
          <li>We are not liable for losses caused by a chama's officials or members — including theft, fraud, mistakes, unpaid contributions, loan defaults, misrecorded cash, or disputes between them.</li>
          <li>We are not liable for loss from a payment sent to the wrong number, a wrong settlement account supplied by the chama, a PIN or code you shared, or a device that was not secured.</li>
          <li>We are not liable for indirect or consequential loss, loss of profit, savings, opportunity or goodwill, or for loss that was not reasonably foreseeable.</li>
          <li>Our total liability to a chama for all claims in any 12-month period is limited to the amount that chama paid us in the 12 months before the claim arose, or {kes(LEGAL.liabilityFloorKes)} if it paid nothing.</li>
        </UL>
        <P>None of this excludes liability for fraud, death or personal injury caused by negligence, or anything else that Kenyan law does not allow to be excluded or limited.</P>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 20 */
  {
    id: 'indemnity',
    title: 'Your promise to cover our losses from misuse',
    body: (
      <P>
        A chama, and each official acting for it, will cover {LEGAL.brand} for loss, claims and reasonable costs arising from: content or SMS they send; collecting or using members' data without proper authority;
        a breach of these Terms or of the law; or a dispute among members or with officials that is brought against us. We will tell you of any claim and let you help deal with it.
      </P>
    ),
  },

  /* ------------------------------------------------------------------ 21 */
  {
    id: 'fraud',
    title: 'Disputes inside a chama, fraud and legal requests',
    body: (
      <>
        <UL>
          <li>We cannot decide who is right in a dispute within a chama or order anyone to pay. Settle it using your chama's rules, mediation, or the courts.</li>
          <li>If you suspect fraud or misuse, write to <Mail /> straight away. We can preserve records and, where we reasonably can, pause features (for example SMS or online collection) while it is looked into.</li>
          <li>We may keep, disclose or hand over records where the law, a court order or a competent authority requires it, or to prevent fraud or harm. We will, where lawful, tell the affected chama.</li>
          <li>The records in {LEGAL.product} may be used as evidence of what was recorded.</li>
        </UL>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 22 */
  {
    id: 'suspension',
    title: 'Suspension, ending your use and closing a chama',
    body: (
      <>
        <UL>
          <li><strong>By you.</strong> You can stop using {LEGAL.product} at any time. The Chair can move the chama to the Free plan. Ask us in writing if you want a chama closed.</li>
          <li><strong>By us.</strong> We may suspend or close an account, a chama or a feature if these Terms are broken, there is suspected fraud or unlawful use, payment is not made, or the law requires. Where we reasonably can, we will warn you first and tell you why.</li>
          <li><strong>After closure.</strong> You lose access. We keep records as set out in the <PrivacyLink />, including financial records for up to {LEGAL.financialRecordRetentionYears} years where the law requires it. Payments already in progress still complete.</li>
          <li>Sections that by their nature should continue (payments owed, liability, disputes, governing law) survive.</li>
        </UL>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 23 */
  {
    id: 'privacy',
    title: 'Privacy',
    body: (
      <P>
        How we collect, use and protect personal information is explained in our <PrivacyLink />, which forms part of these Terms. In short: we use your data only to deliver {LEGAL.product}, we do not sell it,
        and we do not share it with advertisers or data brokers.
      </P>
    ),
  },

  /* ------------------------------------------------------------------ 24 */
  {
    id: 'changes',
    title: 'Changes to these Terms',
    body: (
      <P>
        We may update these Terms, for example when we add a feature or the law changes. The version and effective date are shown at the top. For a change that affects your rights or what you pay,
        we will give notice in the app (or by SMS to the registered phone) before it applies. If you keep using {LEGAL.product} after the effective date you accept the new version; if you do not agree, stop using it and ask us to close your chama.
      </P>
    ),
  },

  /* ------------------------------------------------------------------ 25 */
  {
    id: 'law',
    title: 'Governing law and how disputes are resolved',
    body: (
      <>
        <UL>
          <li>These Terms are governed by the laws of Kenya.</li>
          <li>Please write to <Mail /> first. We will work with you to resolve a complaint in good faith, and aim to respond within 14 days.</li>
          <li>If we cannot resolve it, either side may refer the dispute to mediation, and failing that to the courts of Kenya. Nothing stops a consumer from using the rights and remedies Kenyan consumer-protection law gives them.</li>
        </UL>
      </>
    ),
  },

  /* ------------------------------------------------------------------ 26 */
  {
    id: 'general',
    title: 'General',
    body: (
      <UL>
        <li><strong>Electronic agreement.</strong> You accept these Terms electronically, and records of your acceptance, payments and actions kept by us are valid evidence.</li>
        <li><strong>Notices.</strong> We may notify you in the app, by SMS to your registered phone, by WhatsApp, or by email where we have it. You can reach us at <Mail />.</li>
        <li><strong>Whole agreement.</strong> These Terms and the Privacy Policy are the whole agreement about {LEGAL.product}, and replace earlier versions.</li>
        <li><strong>If a part is invalid,</strong> the rest still applies. If we do not enforce a right straight away, we have not given it up.</li>
        <li><strong>Assignment.</strong> You may not transfer your rights under these Terms. We may transfer ours to a successor of the business, who will be bound by them and by the Privacy Policy.</li>
        <li><strong>Events beyond our control</strong> (for example network or power failure, or an outage at Paystack or a mobile network) do not make us liable for delay or failure caused by them.</li>
        <li><strong>Language.</strong> The English version prevails over any translation.</li>
      </UL>
    ),
  },

  /* ------------------------------------------------------------------ 27 */
  {
    id: 'contact',
    title: 'Contact us',
    body: (
      <>
        <P>
          <strong>{LEGAL.company}</strong><br />
          {LEGAL.place}<br />
          Email: <Mail /><br />
          Web: {LEGAL.siteUrl.replace('https://', '')}
        </P>
      </>
    ),
  },
];

export default function TermsPage() {
  useSeo({
    title: `Terms & Conditions | ${LEGAL.product} by ${LEGAL.brand}`,
    description: `The terms for using ${LEGAL.product}: accounts, chama and official responsibilities, payments and fees, SMS, loans, merry-go-round, liability and more.`,
    path: LEGAL_PATHS.terms,
  });
  return (
    <LegalLayout
      title="Terms & Conditions"
      sections={sections}
      other={{ to: LEGAL_PATHS.privacy, label: 'Read the Privacy Policy' }}
      intro={
        <P>
          Please read these Terms carefully. They explain what {LEGAL.product} does, what it does not do, and who is responsible for what — including for money, SMS and your chama's records.
        </P>
      }
    />
  );
}
