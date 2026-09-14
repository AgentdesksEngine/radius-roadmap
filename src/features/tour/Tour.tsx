import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { useAuth } from '@/api/hooks';
import { Button } from '@/components/ui/Button';
import { TOUR_STEPS, type TourStep } from './steps';
import { useUi } from '../shell/state';
import './tour.css';

/** Per account, so a second device does not re-run it and a shared laptop does. */
function seenKey(userId: string | undefined) {
  return `bt:tour-seen:${userId ?? 'anon'}`;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function rectOf(anchor: string | undefined): Rect | null {
  if (!anchor) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/** A step with an anchor that is not rendered right now is not worth showing. */
function isShowable(step: TourStep): boolean {
  return !step.anchor || rectOf(step.anchor) !== null;
}

export function Tour() {
  const { tourOpen, startTour, endTour } = useUi();
  const { data: auth } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const userId = auth?.user?.id;

  // First sign-in on this browser starts it once. Anything else is the menu item.
  useEffect(() => {
    if (!userId) return;
    try {
      if (localStorage.getItem(seenKey(userId))) return;
      localStorage.setItem(seenKey(userId), '1');
    } catch {
      return; // private mode: skip rather than replay the tour on every load
    }
    setIndex(0);
    startTour();
  }, [userId, startTour]);

  const step = TOUR_STEPS[index];

  // Steps can ask to be shown on a particular route.
  useEffect(() => {
    if (!tourOpen || !step?.path || location.pathname === step.path) return;
    navigate(step.path);
  }, [tourOpen, step, location.pathname, navigate]);

  const close = useCallback(() => {
    endTour();
    setIndex(0);
    setRect(null);
  }, [endTour]);

  const advance = useCallback(
    (delta: number) => {
      let next = index + delta;
      while (next >= 0 && next < TOUR_STEPS.length && !isShowable(TOUR_STEPS[next]!)) next += delta;
      if (next < 0) return;
      if (next >= TOUR_STEPS.length) {
        close();
        return;
      }
      setIndex(next);
    },
    [index, close],
  );

  // Measure after paint, and keep the spotlight glued to the element while things move.
  useLayoutEffect(() => {
    if (!tourOpen) return;
    const measure = () => setRect(rectOf(step?.anchor));
    measure();
    const id = window.setTimeout(measure, 60); // navigation + layout settle
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [tourOpen, step, location.pathname]);

  useEffect(() => {
    if (!tourOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') advance(1);
      else if (e.key === 'ArrowLeft') advance(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tourOpen, advance, close]);

  if (!tourOpen || !step) return null;

  const PAD = 6;
  const spotlight = rect
    ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
    : null;

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="Guided tour">
      <div className="tour-scrim" onClick={close} />
      {spotlight && (
        <div
          className="tour-spotlight"
          style={{ top: spotlight.top, left: spotlight.left, width: spotlight.width, height: spotlight.height }}
        />
      )}
      <div className="tour-card" style={cardPosition(spotlight)}>
        <button className="icon-btn sm tour-close" onClick={close} aria-label="End tour">
          <X />
        </button>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        <div className="tour-foot">
          <span className="faint">
            {index + 1} of {TOUR_STEPS.length}
          </span>
          <span className="spacer" />
          {index > 0 && (
            <Button size="sm" variant="ghost" onClick={() => advance(-1)}>
              Back
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={() => advance(1)}>
            {index === TOUR_STEPS.length - 1 ? 'Done' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  );
}

const CARD_W = 320;
const GAP = 14;

/**
 * Below the anchor, or above it when there is no room. Unanchored steps sit in the middle,
 * which is also the fallback when the element vanished between measuring and painting.
 */
function cardPosition(spot: Rect | null): React.CSSProperties {
  if (!spot) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  const below = spot.top + spot.height + GAP;
  const fitsBelow = below + 200 < window.innerHeight;
  const left = Math.min(Math.max(GAP, spot.left), window.innerWidth - CARD_W - GAP);
  return fitsBelow
    ? { top: below, left }
    : { top: Math.max(GAP, spot.top - GAP - 200), left };
}
