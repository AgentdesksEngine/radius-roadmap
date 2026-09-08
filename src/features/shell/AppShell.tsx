import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useBoard, useSchema } from '@/api/hooks';
import { useBoardRealtime } from '@/api/realtime';
import { Button } from '@/components/ui/Button';
import { Sidebar } from './Sidebar';
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
    newIssueOpen,
    paletteOpen,
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
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape' && !newIssueOpen && !paletteOpen) {
        // A selection is the shallowest thing on screen, so it clears first.
        if (selection.length) setSelection([]);
        else if (openKey) openIssue(null);
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
    newIssueOpen,
    paletteOpen,
    selection,
    setSelection,
  ]);

  return (
    <div className="shell">
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
    </div>
  );
}
