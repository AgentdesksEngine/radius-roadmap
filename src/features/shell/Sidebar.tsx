import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  BarChart3,
  Bookmark,
  Compass,
  ExternalLink,
  Home,
  Inbox,
  Keyboard,
  LayoutGrid,
  List,
  LogOut,
  Monitor,
  Moon,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  Sheet,
  Sun,
  Trash2,
  UserCircle,
  X,
} from 'lucide-react';
import { useAuth, useBoard, useSchema } from '@/api/hooks';
import { Avatar } from '@/components/ui/Avatar';
import { Button, IconButton } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Logo } from '@/components/ui/Logo';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/Menu';
import { Dot } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { TEAM, field, intakeItems, teamCounts } from '@/model/board';
import { useTheme, type Theme } from '@/model/prefs';
import { useSavedViews, viewHref } from '@/model/views';
import { useUi } from './state';

export function Sidebar() {
  const { data: auth } = useAuth();
  const { data: schema } = useSchema();
  const { data: board } = useBoard(Boolean(schema));
  const { filters, setFilters, setNewIssueOpen, groupBy, sidebarOpen, setSidebarOpen, setShortcutsOpen, startTour } =
    useUi();
  const { views, save, remove, setPinned } = useSavedViews();
  const [theme, setTheme] = useTheme();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const teamField = field(schema, TEAM);
  const counts = board ? teamCounts(board.items) : new Map<string, number>();
  const openTotal = board
    ? board.items.filter((i) => i.state === 'OPEN' && !i.isArchived).length
    : 0;
  const intakeCount = board ? intakeItems(board.items).length : 0;
  const me = auth?.user?.id;
  const myIssuesActive =
    me != null && filters.assignees.length === 1 && filters.assignees[0] === me;

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const THEMES: { id: Theme; label: string; icon: ReactNode }[] = [
    { id: 'light', label: 'Light', icon: <Sun /> },
    { id: 'dark', label: 'Dark', icon: <Moon /> },
    { id: 'system', label: 'Match system', icon: <Monitor /> },
  ];

  // The sidebar is a sheet on narrow screens; going somewhere should put it away.
  useEffect(() => setSidebarOpen(false), [location.pathname, setSidebarOpen]);

  const [naming, setNaming] = useState<string | null>(null);
  const saveCurrentView = () => {
    const name = naming?.trim();
    if (!name) return;
    save({ name, path: location.pathname, filters, groupBy })
      .then(() => toast.success(`Saved “${name}”`))
      .catch((e: Error) => toast.error(`Couldn’t save the view: ${e.message}`));
    setNaming(null);
  };

  return (
    <nav className={`sidebar ${sidebarOpen ? 'open' : ''}`} aria-label="Main">
      <div className="sidebar-head">
        <Logo small />
        <div className="truncate">
          Radius
          <span className="sub truncate">{schema?.title ?? 'Bugtracker'}</span>
        </div>
        <IconButton
          label="Close menu"
          className="nav-close"
          size="sm"
          onClick={() => setSidebarOpen(false)}
        >
          <X />
        </IconButton>
      </div>
      <Button className="new-issue-btn" icon={<Plus />} onClick={() => setNewIssueOpen(true)} data-tour="new-issue">
        New issue
        <kbd className="kbd" style={{ marginLeft: 'auto' }}>
          C
        </kbd>
      </Button>

      <NavLink to="/home" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} data-tour="nav-home">
        <Home /> Home
      </NavLink>
      <NavLink to="/inbox" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} data-tour="nav-intake">
        <Inbox /> Intake
        <span className="count">{intakeCount || ''}</span>
      </NavLink>
      <NavLink to="/board" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} data-tour="nav-board">
        <LayoutGrid /> Board
      </NavLink>
      <NavLink to="/list" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <List /> List
      </NavLink>
      <NavLink to="/sheet" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <Sheet /> Spreadsheet
      </NavLink>
      <NavLink
        to="/analytics"
        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
        data-tour="nav-analytics"
      >
        <BarChart3 /> Analytics
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
      <button
        className={`nav-item ${filters.team === null ? 'active' : ''}`}
        onClick={() => setFilters((f) => ({ ...f, team: null }))}
      >
        <Dot color={undefined} /> All teams
        <span className="count">{openTotal || ''}</span>
      </button>
      {teamField?.options?.map((o) => (
        <button
          key={o.id}
          className={`nav-item ${filters.team === o.name ? 'active' : ''}`}
          onClick={() => setFilters((f) => ({ ...f, team: f.team === o.name ? null : o.name }))}
        >
          <Dot color={o.color} /> {o.name}
          <span className="count">{counts.get(o.name) || ''}</span>
        </button>
      ))}
      {(counts.get('__none') ?? 0) > 0 && (
        <button
          className="nav-item"
          style={{ color: 'var(--text-3)' }}
          onClick={() =>
            setFilters((f) => ({ ...f, team: null, select: { ...f.select, [TEAM]: ['__none'] } }))
          }
        >
          <Dot color={undefined} /> No team
          <span className="count">{counts.get('__none')}</span>
        </button>
      )}

      <div className="sidebar-section" data-tour="views">
        <span>Views</span>
        <IconButton
          label="Save the current filters as a view"
          size="sm"
          onClick={() => setNaming('')}
        >
          <Plus />
        </IconButton>
      </div>
      {views.length === 0 && (
        <span className="sidebar-hint">Filter the board, then save it here.</span>
      )}
      {views.map((v) => (
        <div key={v.id} className="nav-row">
          <button className="nav-item" onClick={() => navigate(viewHref(v))}>
            {v.pinned ? <Pin /> : <Bookmark />} <span className="truncate">{v.name}</span>
          </button>
          <Menu>
            <MenuTrigger asChild>
              <button className="icon-btn sm row-menu" aria-label={`Actions for ${v.name}`}>
                <MoreHorizontal />
              </button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem onSelect={() => setPinned(v.id, !v.pinned)}>
                {v.pinned ? <PinOff /> : <Pin />} {v.pinned ? 'Unpin from Home' : 'Pin to Home'}
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  void navigator.clipboard?.writeText(`${window.location.origin}${viewHref(v)}`);
                  toast.success('Copied a link to this view');
                }}
              >
                <ExternalLink /> Copy link
              </MenuItem>
              <MenuItem onSelect={() => remove(v.id)}>
                <Trash2 /> Delete view
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      ))}

      <button
        className={`nav-item ${filters.archived ? 'active' : ''}`}
        style={{ marginTop: 8 }}
        onClick={() =>
          setFilters((f) => ({ ...f, archived: !f.archived, state: f.archived ? 'active' : 'all' }))
        }
      >
        <Archive /> Archived
      </button>

      <Dialog
        open={naming !== null}
        onOpenChange={(o) => !o && setNaming(null)}
        title="Save this view"
        width={420}
      >
        <p className="faint" style={{ margin: '0 0 10px' }}>
          Saves the filters, grouping and layout you have on screen right now. The view is a link,
          so you can share it.
        </p>
        <input
          className="input"
          autoFocus
          placeholder="e.g. Urgent iOS bugs from agents"
          value={naming ?? ''}
          onChange={(e) => setNaming(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && saveCurrentView()}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <Button size="sm" variant="ghost" onClick={() => setNaming(null)}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={!naming?.trim()} onClick={saveCurrentView}>
            Save view
          </Button>
        </div>
      </Dialog>

      <div className="sidebar-foot">
        <Menu>
          <MenuTrigger asChild>
            <button className="user">
              <Avatar person={auth?.user ?? null} size={20} />
              <span className="truncate">{auth?.user?.name || auth?.user?.email}</span>
            </button>
          </MenuTrigger>
          <MenuContent side="top">
            <MenuItem onSelect={() => window.open(schema?.url, '_blank')}>
              <ExternalLink /> Open project home
            </MenuItem>
            <MenuItem onSelect={() => qc.invalidateQueries()}>Refresh data</MenuItem>
            <MenuItem onSelect={() => startTour()}>
              <Compass /> Show tour
            </MenuItem>
            <MenuItem onSelect={() => setShortcutsOpen(true)} hint="?">
              <Keyboard /> Keyboard shortcuts
            </MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={() => (window.location.href = '/api/auth/logout')}>
              <LogOut /> Sign out
            </MenuItem>
          </MenuContent>
        </Menu>
        <Menu>
          <MenuTrigger asChild>
            <button className="icon-btn" aria-label={`Theme: ${theme}`}>
              <ThemeIcon />
            </button>
          </MenuTrigger>
          <MenuContent side="top" align="end">
            <MenuLabel>Theme</MenuLabel>
            {THEMES.map((t) => (
              <MenuItem key={t.id} onSelect={() => setTheme(t.id)} hint={theme === t.id ? '✓' : undefined}>
                {t.icon} {t.label}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      </div>
    </nav>
  );
}
