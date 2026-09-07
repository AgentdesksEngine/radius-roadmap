export function PriorityIcon({ name, size = 14 }: { name?: string; size?: number }) {
  const n = (name ?? '').toLowerCase();
  const label = name ?? 'No priority';
  if (n.startsWith('urgent')) {
    return (
      <span className="priority-icon urgent" title={label} aria-label={label}>
        <svg viewBox="0 0 16 16" width={size} height={size}>
          <rect x="1" y="1" width="14" height="14" rx="3" fill="currentColor" />
          <path d="M8 4v5" stroke="white" strokeWidth="2" strokeLinecap="round" />
          <circle cx="8" cy="11.8" r="1.1" fill="white" />
        </svg>
      </span>
    );
  }
  const bars = n.startsWith('high') ? 3 : n.startsWith('medium') ? 2 : n.startsWith('low') ? 1 : 0;
  return (
    <span className="priority-icon" title={label} aria-label={label}>
      <svg viewBox="0 0 16 16" width={size} height={size}>
        {[0, 1, 2].map((i) => (
          <rect key={i} x={1.5 + i * 4.75} y={10 - i * 3.5} width={3.5} height={4.5 + i * 3.5} rx={1} fill="currentColor" opacity={i < bars ? 1 : 0.22} />
        ))}
      </svg>
    </span>
  );
}
