/** Stroke-icon set matching the demo's navIcon() SVGs, as React components. */
import type { JSX, SVGProps } from 'react';

const base = { width: 19, height: 19, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 };

function Icon(props: SVGProps<SVGSVGElement> & { d: string }) {
  const { d, ...rest } = props;
  return (
    <svg {...base} {...rest}>
      <path d={d} />
    </svg>
  );
}

export const NavIcons: Record<string, (props: SVGProps<SVGSVGElement>) => JSX.Element> = {
  dashboard: (p) => <Icon d="M3 13h8V3H3v10Zm10 8h8V3h-8v18ZM3 21h8v-6H3v6Z" {...p} />,
  members: (p) => (
    <svg {...base} {...p}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.5 20c0-3.6 3-6.2 6.5-6.2s6.5 2.6 6.5 6.2" />
      <circle cx="17.5" cy="8.5" r="2.4" />
      <path d="M15.8 13.9c2.8.3 5.2 2.6 5.2 6.1" />
    </svg>
  ),
  contributions: (p) => (
    <svg {...base} {...p}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M3 11h18M7 15h4" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  ),
  merrygoround: (p) => (
    <svg {...base} {...p}>
      <path d="M20 11A8 8 0 0 0 6.3 6.3L3 9.5" />
      <path d="M3 5v4.5h4.5" />
      <path d="M4 13a8 8 0 0 0 13.7 4.7L21 14.5" />
      <path d="M21 19v-4.5h-4.5" />
    </svg>
  ),
  loans: (p) => <Icon d="M12 2v20M17 6.5c0-2-2.2-3.5-5-3.5S7 4.5 7 6.5 9.2 9.8 12 10c2.8.2 5 1.9 5 4s-2.2 3.5-5 3.5-5-1.4-5-3.3" {...p} />,
  payments: (p) => (
    <svg {...base} {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 9h18M7 13h3" />
    </svg>
  ),
  communication: (p) => <Icon d="M4 4h13l3 4-3 4H4z M4 12v8m0-4h9" {...p} />,
  minutes: (p) => (
    <svg {...base} {...p}>
      <path d="M14 3v5h5" />
      <path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M8 13h8M8 17h5" />
    </svg>
  ),
  reports: (p) => (
    <svg {...base} {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 4v3m8-3v3" />
    </svg>
  ),
  billing: (p) => <Icon d="M12 2a15 15 0 0 0 0 20 15 15 0 0 0 0-20Z M2.5 9h19M2.5 15h19" {...p} />,
  settings: (p) => (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.6 1Z" />
    </svg>
  ),
  mycontributions: (p) => (
    <svg {...base} {...p}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M3 11h18M7 15h4" />
    </svg>
  ),
  mymgr: (p) => (
    <svg {...base} {...p}>
      <path d="M20 11A8 8 0 0 0 6.3 6.3L3 9.5" />
      <path d="M3 5v4.5h4.5" />
    </svg>
  ),
  myloans: (p) => <Icon d="M12 2v20M17 6.5c0-2-2.2-3.5-5-3.5S7 4.5 7 6.5 9.2 9.8 12 10c2.8.2 5 1.9 5 4s-2.2 3.5-5 3.5-5-1.4-5-3.3" {...p} />,
  messages: (p) => <Icon d="M4 4h13l3 4-3 4H4z M4 12v8m0-4h9" {...p} />,
};
