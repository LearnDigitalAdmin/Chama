/** The MyChama app-icon tile (public/icon.svg, generated from the SAMUHIA Logo Studio by tools/brand). */
export default function BrandMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  return <img src="/icon.svg" width={size} height={size} alt="" aria-hidden="true" decoding="async" className={`shrink-0 rounded-lg ${className}`} />;
}
