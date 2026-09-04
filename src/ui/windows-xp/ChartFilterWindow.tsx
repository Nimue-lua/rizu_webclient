import { useSyncExternalStore } from "react";
import type { ChartSelector } from "../../select/ChartSelector";

const modes = [
  { value: null, label: "All game modes" },
  { value: 0, label: "osu!standard" },
  { value: 3, label: "osu!mania" },
] as const;

export function ChartFilterWindow({ selector }: { selector: ChartSelector }) {
  const selection = useSyncExternalStore(selector.subscribe, selector.getSnapshot);

  return (
    <section className="windows-xp-chart-filter">
      <p>Select the game mode displayed in the Music Library.</p>
      <fieldset>
        <legend>Game mode</legend>
        {modes.map((mode) => (
          <label key={mode.label} className={selection.selected_mode === mode.value ? "selected" : ""}>
            <input type="radio" name="windows-xp-chart-mode" checked={selection.selected_mode === mode.value}
              onChange={() => selector.selectMode(mode.value)} />
            <strong>{mode.label}</strong>
          </label>
        ))}
      </fieldset>
    </section>
  );
}
