import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { ExternalLink, LayoutGrid, List, LogOut, Moon, Plus, RefreshCw, Sun } from 'lucide-react';
import { useBoard, useSchema } from '@/api/hooks';
import { matchesQuery, normalizeQuery } from '@/model/board';
import { useTheme } from '@/model/prefs';
import { useUi } from '../shell/state';
import './palette.css';

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, openIssue, setNewIssueOpen } = useUi();
  const { data: board } = useBoard();
  const { data: schema } = useSchema();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [, setTheme, resolved] = useTheme();
  const [q, setQ] = useState('');

  const matches = useMemo(() => {
    const nq = normalizeQuery(q);
    if (!board) return [];
    const list = nq ? board.items.filter((i) => matchesQuery(i, nq)) : board.items;
    return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);
  }, [board, q]);

  const run = (fn: () => void) => () => {
    fn();
    setPaletteOpen(false);
    setQ('');
  };

  return (
    <Command.Dialog open={paletteOpen} onOpenChange={setPaletteOpen} label="Command menu" className="palette" overlayClassName="dialog-overlay" contentClassName="palette-content" shouldFilter={false}>
      <Command.Input value={q} onValueChange={setQ} placeholder="Search issues or type a command…" />
      <Command.List>
        <Command.Empty>Nothing found</Command.Empty>
        {matches.length > 0 && (
          <Command.Group heading="Issues">
            {matches.map((i) => (
              <Command.Item key={i.itemId} className="menu-item" value={`issue-${i.key}`} onSelect={run(() => openIssue(i.key))}>
                <span className="mono">{i.key}</span>
                <span className="truncate">{i.title}</span>
                {i.state === 'CLOSED' && <span className="hint">closed</span>}
              </Command.Item>
            ))}
          </Command.Group>
        )}
        <Command.Group heading="Actions">
          {[
            { id: 'new', label: 'New issue', icon: <Plus />, hint: 'C', fn: () => setNewIssueOpen(true) },
            { id: 'board', label: 'Go to board', icon: <LayoutGrid />, fn: () => navigate('/board') },
            { id: 'list', label: 'Go to list', icon: <List />, fn: () => navigate('/list') },
            { id: 'theme', label: resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', icon: resolved === 'dark' ? <Sun /> : <Moon />, fn: () => setTheme(resolved === 'dark' ? 'light' : 'dark') },
            { id: 'refresh', label: 'Refresh data', icon: <RefreshCw />, fn: () => qc.invalidateQueries() },
            { id: 'github', label: 'Open project in GitHub', icon: <ExternalLink />, fn: () => window.open(schema?.url, '_blank') },
            { id: 'signout', label: 'Sign out', icon: <LogOut />, fn: () => (window.location.href = '/api/auth/logout') },
          ]
            .filter((a) => !q || a.label.toLowerCase().includes(q.toLowerCase()))
            .map((a) => (
              <Command.Item key={a.id} className="menu-item" value={`action-${a.id}`} onSelect={run(a.fn)}>
                {a.icon}
                <span>{a.label}</span>
                {a.hint && <span className="hint">{a.hint}</span>}
              </Command.Item>
            ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
