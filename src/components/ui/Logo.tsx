export function Logo({ small }: { small?: boolean }) {
  return (
    <span className={`logo ${small ? 'sm' : ''}`} aria-hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <circle cx="12" cy="12" r="7" />
        <path d="M12 5v14M5 12h14" opacity="0.6" />
      </svg>
    </span>
  );
}
