import { Navigate, Route, Routes } from 'react-router-dom';
import { NotMemberPage, RequireAuth } from './features/auth/AuthPages';
import { AppShell } from './features/shell/AppShell';
import { UiStateProvider } from './features/shell/state';
import { BoardView } from './features/board/BoardView';
import { ListView } from './features/list/ListView';

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
        <Route path="/" element={<Navigate to="/board" replace />} />
        <Route path="/board" element={<BoardView />} />
        <Route path="/list" element={<ListView />} />
        <Route path="*" element={<Navigate to="/board" replace />} />
      </Route>
    </Routes>
  );
}
