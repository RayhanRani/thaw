/** Thaw mark: a snowflake whose lower arm melts into a drop. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="thaw-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7dd3fc" />
          <stop offset="1" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#thaw-logo)" />
      <g stroke="#0b1220" strokeWidth="2.2" strokeLinecap="round" fill="none">
        <path d="M16 6v12.5" />
        <path d="M7.3 11l15.4 9" />
        <path d="M24.7 11L9.3 20" />
        <path d="M13.6 7.6L16 9.6l2.4-2" />
      </g>
      <path d="M16 18.6c-2.2 2.6-3.3 4.4-3.3 5.6a3.3 3.3 0 006.6 0c0-1.2-1.1-3-3.3-5.6z" fill="#0b1220" />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className ?? 'flex items-center gap-2'}>
      <Logo />
      <span className="text-[17px] font-semibold tracking-tight">Thaw</span>
    </span>
  )
}
