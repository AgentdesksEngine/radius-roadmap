import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Undo2, X } from 'lucide-react';

type Kind = 'error' | 'success' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
  /** Renders the undo arrow — the common case for a reversible write. */
  undo?: boolean;
}

export interface ToastOptions {
  action?: ToastAction;
  /** Milliseconds on screen. Defaults: 7s for errors, 3.5s otherwise, 8s with an action. */
  duration?: number;
}

interface Toast {
  id: number;
  kind: Kind;
  message: string;
  action?: ToastAction;
}

interface Api {
  error: (m: string, o?: ToastOptions) => void;
  success: (m: string, o?: ToastOptions) => void;
  info: (m: string, o?: ToastOptions) => void;
}

const noop: Api = { error: () => {}, success: () => {}, info: () => {} };
const Ctx = createContext<Api>(noop);
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (kind: Kind, message: string, opts?: ToastOptions) => {
      const id = ++seq.current;
      setToasts((t) => [...t.slice(-3), { id, kind, message, action: opts?.action }]);
      // An action needs long enough to notice, read and reach.
      const ms = opts?.duration ?? (opts?.action ? 8000 : kind === 'error' ? 7000 : 3500);
      window.setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );
  const api = useMemo<Api>(
    () => ({
      error: (m, o) => push('error', m, o),
      success: (m, o) => push('success', m, o),
      info: (m, o) => push('info', m, o),
    }),
    [push],
  );
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.kind}`}
            role={t.kind === 'error' ? 'alert' : 'status'}
            aria-live={t.kind === 'error' ? 'assertive' : 'polite'}
          >
            <span className="toast-msg">{t.message}</span>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.undo && <Undo2 />}
                {t.action.label}
              </button>
            )}
            <button className="icon-btn sm" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <X />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
