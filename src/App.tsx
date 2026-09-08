import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthCallback, NotMemberPage, RequireAuth } from './features/auth/AuthPages';
import { AppShell } from './features/shell/AppShell';
import { UiStateProvider } from './features/shell/state';
import { AnalyticsView } from './features/analytics/AnalyticsView';
import { BoardView } from './features/board/BoardView';
import { InboxView } from './features/inbox/InboxView';
import { ListView } from './features/list/ListView';
import { SheetView } from './features/sheet/SheetView';

export function App() {
  return (
    <Routes>
      <Route path="/not-a-member" element={<NotMemberPage />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route
        element={
          <RequireAuth>
            <UiStateProvider>
              <AppShell />
            </UiStateProvider>
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/board" replace />} />
        <Route path="/board" element={<BoardView />} />
        <Route path="/list" element={<ListView />} />
        <Route path="/sheet" element={<SheetView />} />
        <Route path="/inbox" element={<InboxView />} />
        <Route path="/analytics" element={<AnalyticsView />} />
        <Route path="*" element={<Navigate to="/board" replace />} />
      </Route>
    </Routes>
  );
}
