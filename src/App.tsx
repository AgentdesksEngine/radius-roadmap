import { Navigate, Route, Routes } from 'react-router-dom';
import { NotMemberPage, RequireAuth } from './features/auth/AuthPages';
import { AppShell } from './features/shell/AppShell';
import { UiStateProvider } from './features/shell/state';
import { AnalyticsView } from './features/analytics/AnalyticsView';
import { BoardView } from './features/board/BoardView';
import { HomeView } from './features/home/HomeView';
import { InboxView } from './features/inbox/InboxView';
import { IssueRoute } from './features/issue/IssueRoute';
import { ListView } from './features/list/ListView';
import { SheetView } from './features/sheet/SheetView';

export function App() {
  return (
    <Routes>
      <Route path="/not-a-member" element={<NotMemberPage />} />
      <Route
        element={
          <RequireAuth>
            <UiStateProvider>
              <AppShell />
            </UiStateProvider>
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<HomeView />} />
        <Route path="/board" element={<BoardView />} />
        <Route path="/list" element={<ListView />} />
        <Route path="/sheet" element={<SheetView />} />
        <Route path="/inbox" element={<InboxView />} />
        <Route path="/analytics" element={<AnalyticsView />} />
        {/* Deep link from Slack DMs and issueUrl(): opens the board with the panel already up. */}
        <Route path="/issue/:key" element={<IssueRoute />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Route>
    </Routes>
  );
}
