import { NavLink } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, LayoutGrid, List, LogOut, Monitor, Moon, Plus, Sun, UserCircle } from 'lucide-react';
import { useAuth, useBoard, useSchema } from '@/api/hooks';
import { Avatar } from '@/components/ui/Avatar';
import { Button, IconButton } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { Dot } from '@/components/ui/Tag';
import { TEAM, field, teamCounts } from '@/model/board';
import { useTheme } from '@/model/prefs';
import { useUi } from './state';

export function Sidebar() {
  const { data: auth } = useAuth();
  const { data: schema } = useSchema();
  const { data: board } = useBoard(Boolean(schema));
  const { filters, setFilters, setNewIssueOpen } = useUi();
  const [theme, setTheme] = useTheme();
  const qc = useQueryClient();

  const teamField = field(schema, TEAM);
  const counts = board ? teamCounts(board.items) : new Map<string, number>();
  const openTotal = board ? board.items.filter((i) => i.state === 'OPEN').length : 0;
  const me = auth?.user?.login;
  const myIssuesActive = me != null && filters.assignees.length === 1 && filters.assignees[0] === me;

  const cycleTheme = () => setTheme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system');
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

  return (
    <nav className="sidebar" aria-label="Main">
      <div className="sidebar-head">
        <Logo small />
        <div className="truncate">
          Radius
          <span className="sub truncate">{schema?.title ?? 'Bugtracker'}</span>
        </div>
      </div>
      <Button className="new-issue-btn" icon={<Plus />} onClick={() => setNewIssueOpen(true)}>
        New issue
        <kbd className="kbd" style={{ marginLeft: 'auto' }}>
          C
        </kbd>
      </Button>

      <NavLink to="/board" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <LayoutGrid /> Board
      </NavLink>
      <NavLink to="/list" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <List /> List
      </NavLink>
      <button
        className={`nav-item ${myIssuesActive ? 'active' : ''}`}
        onClick={() => setFilters((f) => ({ ...f, assignees: myIssuesActive || !me ? [] : [me] }))}
      >
        <UserCircle /> My issues
      </button>

      <div className="sidebar-section">
        <span>Teams</span>
      </div>
      <button className={`nav-item ${filters.team === null ? 'active' : ''}`} onClick={() => setFilters((f) => ({ ...f, team: null }))}>
        <Dot color={undefined} /> All teams
        <span className="count">{openTotal || ''}</span>
      </button>
      {teamField?.options?.map((o) => (
        <button key={o.id} className={`nav-item ${filters.team === o.name ? 'active' : ''}`} onClick={() => setFilters((f) => ({ ...f, team: f.team === o.name ? null : o.name }))}>
          <Dot color={o.color} /> {o.name}
          <span className="count">{counts.get(o.name) || ''}</span>
        </button>
      ))}
      {(counts.get('__none') ?? 0) > 0 && (
        <button className="nav-item" style={{ color: 'var(--text-3)' }} onClick={() => setFilters((f) => ({ ...f, team: null, select: { ...f.select, [TEAM]: ['__none'] } }))}>
          <Dot color={undefined} /> No team
          <span className="count">{counts.get('__none')}</span>
        </button>
      )}

      <div className="sidebar-foot">
        <Menu>
          <MenuTrigger asChild>
            <button className="user">
              <Avatar person={auth?.user ?? null} size={20} />
              <span className="truncate">{auth?.user?.name || auth?.user?.login}</span>
            </button>
          </MenuTrigger>
          <MenuContent side="top">
            <MenuItem onSelect={() => window.open(schema?.url, '_blank')}>
              <ExternalLink /> Open project in GitHub
            </MenuItem>
            <MenuItem onSelect={() => qc.invalidateQueries()}>Refresh data</MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={() => (window.location.href = '/api/auth/logout')}>
              <LogOut /> Sign out
            </MenuItem>
          </MenuContent>
        </Menu>
        <IconButton label={`Theme: ${theme}`} onClick={cycleTheme}>
          <ThemeIcon />
        </IconButton>
      </div>
    </nav>
  );
}
