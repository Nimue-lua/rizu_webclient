import { useRef } from "react";
import { flushSync } from "react-dom";
export type AppTransition = "screen" | "song-loading" | "loading-gameplay" | "gameplay-result";
export type TransitionRunner = (kind: AppTransition, update: () => void) => void;

interface PendingTransition {
  kind: AppTransition;
  update: () => void;
}

export function useAppViewTransition(): TransitionRunner {
  const active = useRef<ViewTransition | null>(null);
  const pending = useRef<PendingTransition | null>(null);

  const run: TransitionRunner = (kind, update) => {
    if (!document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      update();
      return;
    }
    if (active.current) {
      pending.current = { kind, update };
      active.current.skipTransition();
      return;
    }
    document.documentElement.dataset.viewTransition = kind;
    const transition = document.startViewTransition(() => flushSync(update));
    active.current = transition;
    void transition.finished.catch(() => undefined).finally(() => {
      if (active.current !== transition) return;
      active.current = null;
      delete document.documentElement.dataset.viewTransition;
      const next = pending.current;
      pending.current = null;
      if (next) requestAnimationFrame(() => requestAnimationFrame(() => run(next.kind, next.update)));
    });
  };

  return run;
}
