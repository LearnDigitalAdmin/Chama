export default function ComingSoon({ title }: { title: string }) {
  return (
    <div className="card p-8 text-center max-w-md mx-auto mt-10">
      <div className="w-12 h-12 rounded-full bg-forest-50 flex items-center justify-center text-forest-600 mx-auto mb-4">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 3" />
        </svg>
      </div>
      <h2 className="font-display font-semibold text-lg text-ink">{title}</h2>
      <p className="text-sm text-forest-900/60 mt-1.5">This section lands in Phase 4 of the live build.</p>
    </div>
  );
}
