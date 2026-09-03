import { useEffect } from "react";
import { settings } from "../config/Settings";
import { ConfigNumberControl } from "./ConfigNumberControl";

interface GameplayModifiersModalProps {
  mode: "osu" | "mania";
  constant_scroll: boolean;
  tap_only: boolean;
  overall_difficulty: number | null;
  circle_size: number | null;
  approach_rate: number | null;
  onConstantScrollChange: (constant_scroll: boolean) => void;
  onTapOnlyChange: (tap_only: boolean) => void;
  onOverallDifficultyChange: (overall_difficulty: number | null) => void;
  onCircleSizeChange: (circle_size: number | null) => void;
  onApproachRateChange: (approach_rate: number | null) => void;
  onExit: () => void;
}

export function GameplayModifiersModal({
  mode,
  constant_scroll,
  tap_only,
  overall_difficulty,
  circle_size,
  approach_rate,
  onConstantScrollChange,
  onTapOnlyChange,
  onOverallDifficultyChange,
  onCircleSizeChange,
  onApproachRateChange,
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
          {mode === "mania" && <><label className="settings-checkbox-control">
            <input
              autoFocus
              type="checkbox"
              checked={constant_scroll}
              onChange={(event) => onConstantScrollChange(event.target.checked)}
            />
            <span aria-hidden="true" />
            <strong>Constant scroll speed</strong>
          </label>
          <label className="settings-checkbox-control">
            <input
              type="checkbox"
              checked={tap_only}
              onChange={(event) => onTapOnlyChange(event.target.checked)}
            />
            <span aria-hidden="true" />
            <strong>No Long Notes</strong>
          </label></>}
          {mode === "osu" && <>
            <label className="settings-checkbox-control">
              <input autoFocus type="checkbox" checked={overall_difficulty !== null}
                onChange={(event) => onOverallDifficultyChange(event.target.checked ? settings.osu_overall_difficulty.default : null)} />
              <span aria-hidden="true" />
              <strong>Customize Overall Difficulty</strong>
            </label>
            {overall_difficulty !== null && <ConfigNumberControl definition={settings.osu_overall_difficulty}
              label="Overall Difficulty" value={overall_difficulty} onChange={onOverallDifficultyChange} />}
            <label className="settings-checkbox-control">
              <input type="checkbox" checked={circle_size !== null}
                onChange={(event) => onCircleSizeChange(event.target.checked ? settings.osu_circle_size.default : null)} />
              <span aria-hidden="true" />
              <strong>Customize Circle Size</strong>
            </label>
            {circle_size !== null && <ConfigNumberControl definition={settings.osu_circle_size}
              label="Circle Size" value={circle_size} onChange={onCircleSizeChange} />}
            <label className="settings-checkbox-control">
              <input type="checkbox" checked={approach_rate !== null}
                onChange={(event) => onApproachRateChange(event.target.checked ? settings.osu_approach_rate.default : null)} />
              <span aria-hidden="true" />
              <strong>Customize Approach Rate</strong>
            </label>
            {approach_rate !== null && <ConfigNumberControl definition={settings.osu_approach_rate}
              label="Approach Rate" value={approach_rate} onChange={onApproachRateChange} />}
          </>}
        </div>
      </section>
    </div>
  );
}
