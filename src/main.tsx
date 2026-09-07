import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import { App } from './App';
import { ToastProvider } from './components/ui/Toast';
import { applyTheme } from './model/prefs';
import './styles/globals.css';
import './components/ui/ui.css';

try {
  applyTheme(JSON.parse(localStorage.getItem('bt:theme') ?? '"system"'));
} catch {
  applyTheme('system');
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: (count, err) => count < 2 && !(err instanceof Error && 'status' in err && (err as { status: number }).status === 401) },
    mutations: { retry: 0 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RadixTooltip.Provider>
        <ToastProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ToastProvider>
      </RadixTooltip.Provider>
    </QueryClientProvider>
  </StrictMode>,
);
