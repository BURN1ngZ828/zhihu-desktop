import { useEffect, useRef, useState } from 'react';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Interruptible mount/unmount presence hook.
 * Keeps DOM mounted briefly during exit transition and cancels unmount immediately if reopened.
 */
export function usePresence(open: boolean, exitMs = 130): { mounted: boolean; state: 'open' | 'closed' } {
  const [mounted, setMounted] = useState(open);
  const [state, setState] = useState<'open' | 'closed'>(open ? 'open' : 'closed');
  const mountedRef = useRef(open);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (open) {
      const wasMounted = mountedRef.current;
      mountedRef.current = true;
      setMounted(true);
      if (prefersReducedMotion()) {
        setState('open');
        return;
      }
      if (wasMounted) {
        rafRef.current = window.requestAnimationFrame(() => {
          setState('open');
          rafRef.current = null;
        });
      } else {
        rafRef.current = window.requestAnimationFrame(() => {
          rafRef.current = window.requestAnimationFrame(() => {
            setState('open');
            rafRef.current = null;
          });
        });
      }
    } else if (mountedRef.current) {
      setState('closed');
      const delay = prefersReducedMotion() ? 0 : exitMs;
      if (delay === 0) {
        mountedRef.current = false;
        setMounted(false);
      } else {
        timerRef.current = window.setTimeout(() => {
          mountedRef.current = false;
          setMounted(false);
          timerRef.current = null;
        }, delay);
      }
    }

    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    };
  }, [open, exitMs]);

  return { mounted, state };
}
