import { useEffect } from "react";

interface GameplayModifiersModalProps {
  constant_scroll: boolean;
  tap_only: boolean;
  onConstantScrollChange: (constant_scroll: boolean) => void;
  onTapOnlyChange: (tap_only: boolean) => void;
  onExit: () => void;
}

export function GameplayModifiersModal({
  constant_scroll,
  tap_only,
  onConstantScrollChange,
  onTapOnlyChange,
  onExit,
}: GameplayModifiersModalProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onExit();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onExit]);

  return (
    <div className="gameplay-modifiers-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onExit();
    }}>
      <section className="gameplay-modifiers-modal" role="dialog" aria-modal="true" aria-labelledby="gameplay-modifiers-title">
        <h1 id="gameplay-modifiers-title">Gameplay Modifiers</h1>
        <div className="modifier-checkbox-list">
          <label className="modifier-checkbox">
            <input
              autoFocus
              type="checkbox"
              checked={constant_scroll}
              onChange={(event) => onConstantScrollChange(event.target.checked)}
            />
            <span aria-hidden="true" />
            <strong>Constant scroll speed</strong>
          </label>
          <label className="modifier-checkbox">
            <input
              type="checkbox"
              checked={tap_only}
              onChange={(event) => onTapOnlyChange(event.target.checked)}
            />
            <span aria-hidden="true" />
            <strong>No Long Notes</strong>
          </label>
        </div>
      </section>
    </div>
  );
}
