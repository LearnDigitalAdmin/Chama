/**
 * Small inline loading spinner. Added as part of the MGR repair pass so
 * every new async action (charge, settle, repair, close…) has a real
 * loading state instead of only a disabled button with swapped text.
 * Uses the `.spinner` class in src/index.css — no extra dependency.
 */
export function Spinner({ className = '' }: { className?: string }) {
  return <span className={`spinner ${className}`.trim()} role="status" aria-label="Loading" />;
}

export default Spinner;
