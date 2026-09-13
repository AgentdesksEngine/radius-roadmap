import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useBoard, useSchema } from '@/api/hooks';
import { useBoardRealtime } from '@/api/realtime';
import { Button } from '@/components/ui/Button';
import { Sidebar } from './Sidebar';
import { ShortcutsDialog } from './Shortcuts';
import { useUi } from './state';
import { IssuePanel } from '../issue/IssuePanel';
import { NewIssueDialog } from '../new-issue/NewIssueDialog';
import { CommandPalette } from '../palette/CommandPalette';
import './shell.css';

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

export function AppShell() {
  const schema = useSchema();
  useBoard(Boolean(schema.data));
  useBoardRealtime(Boolean(schema.data));
  const {
    openKey,
    openIssue,
    setNewIssueOpen,
    setPaletteOpen,
    setShortcutsOpen,
    newIssueOpen,
    paletteOpen,
    shortcutsOpen,
    sidebarOpen,
    setSidebarOpen,
    selection,
    setSelection,
  } = useUi();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
        return;
      }

      // Escape is handled before the typing guard, so it works from inside a field too.
      // The ladder: a field that fully handled it has already called preventDefault; else
      // leave the field, then drop the selection, then close whatever is open.
      if (e.key === 'Escape') {
        if (isTyping(e)) {
          if (!e.defaultPrevented) (e.target as HTMLElement).blur();
          return;
        }
        if (newIssueOpen || paletteOpen || shortcutsOpen) return; // Radix closes these itself
        if (sidebarOpen) setSidebarOpen(false);
        else if (selection.length) setSelection([]);
        else if (openKey) openIssue(null);
        return;
      }

      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (e.key === 'c' && !newIssueOpen) {
        e.preventDefault();
        setNewIssueOpen(true);
      }
      if (e.key === '/') {
        e.preventDefault();
        document.getElementById('search-input')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    openKey,
    openIssue,
    setNewIssueOpen,
    setPaletteOpen,
    setShortcutsOpen,
    newIssueOpen,
    paletteOpen,
    shortcutsOpen,
    sidebarOpen,
    setSidebarOpen,
    selection,
    setSelection,
  ]);

  return (
    <div className="shell">
      {sidebarOpen && (
        <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}
      <Sidebar />
      <main className="main">
        {schema.isError ? (
          <div className="error-banner">
            <span>Couldn’t load the project schema: {(schema.error as Error).message}</span>
            <Button size="sm" onClick={() => schema.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <Outlet />
        )}
      </main>
      <IssuePanel />
      <NewIssueDialog />
      <CommandPalette />
      <ShortcutsDialog />
    </div>
  );
}
