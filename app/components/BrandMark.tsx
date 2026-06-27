// Canonical ShieldFlow brand mark — kept identical to app/icon.svg (the favicon)
// so the logo is the same across the marketing site, auth screens, the in-app
// sidebar, and the browser tab. Navy square · emerald shield · white check.
export function BrandMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="ShieldFlow">
      <rect width="64" height="64" rx="14" fill="#1e3a5f" />
      <path
        d="M32 10 L50 17 V31 C50 43 42.5 51 32 55 C21.5 51 14 43 14 31 V17 Z"
        fill="none"
        stroke="#10b981"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
