import type { Person } from '@shared/types';

export function Avatar({ person, size = 20, title }: { person: Person | null | undefined; size?: number; title?: string }) {
  const style = { width: size, height: size, fontSize: Math.max(9, size * 0.45) };
  if (!person) return <span className="avatar empty" style={style} title={title ?? 'Unassigned'} />;
  const initials = (person.name || person.login).slice(0, 2).toUpperCase();
  return (
    <span className="avatar" style={style} title={title ?? person.name ?? person.login}>
      {person.avatarUrl ? <img src={`${person.avatarUrl}${person.avatarUrl.includes('?') ? '&' : '?'}s=${size * 2}`} alt="" /> : initials}
    </span>
  );
}

export function AvatarStack({ people, size = 18, max = 3 }: { people: Person[]; size?: number; max?: number }) {
  if (!people.length) return null;
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="avatar-stack">
      {shown.map((p) => (
        <Avatar key={p.login} person={p} size={size} />
      ))}
      {rest > 0 && (
        <span className="avatar" style={{ width: size, height: size }}>
          +{rest}
        </span>
      )}
    </span>
  );
}
