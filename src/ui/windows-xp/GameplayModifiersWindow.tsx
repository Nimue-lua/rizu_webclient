import { useId, useSyncExternalStore } from "react";
import type { GameplayModifiersController } from "../../config/GameplaySettingsController";
import { settings } from "../../config/Settings";
import type { NumberDefinition } from "../../config/Config";
import type { ChartSelector } from "../../select/ChartSelector";

function ModifierSlider({ definition, label, value, output, onChange }: {
  definition: NumberDefinition;
  label: string;
  value: number;
  output: string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <label className="windows-xp-modifier-slider" htmlFor={id}>
      <span><strong>{label}</strong><output htmlFor={id}>{output}</output></span>
      <input id={id} type="range" min={definition.min} max={definition.max} step={definition.step}
        value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

export function GameplayModifiersWindow({ selector, modifiers }: {
  selector: ChartSelector;
  modifiers: GameplayModifiersController;
}) {
  useSyncExternalStore(selector.subscribe, selector.getSnapshot);
  const chart = selector.getSelectedChart();
  const mode = chart?.mode === 0 ? "osu" : chart?.mode === 3 ? "mania" : null;

  return (
    <section className="windows-xp-gameplay-modifiers">
      <fieldset>
        <legend>Music speed</legend>
        <ModifierSlider definition={settings.music_rate} label="Playback rate" value={modifiers.music_rate}
          output={`${modifiers.music_rate.toFixed(2)}x`} onChange={modifiers.set_music_rate} />
      </fieldset>

      {mode === "mania" && <fieldset>
        <legend>osu!mania</legend>
        <div className="windows-xp-modifier-checkbox">
          <input id="windows-xp-constant-scroll" type="checkbox" checked={modifiers.constant_scroll}
            onChange={(event) => modifiers.set_constant_scroll(event.target.checked)} />
          <label htmlFor="windows-xp-constant-scroll"><strong>Constant scroll speed</strong></label>
        </div>
        <div className="windows-xp-modifier-checkbox">
          <input id="windows-xp-tap-only" type="checkbox" checked={modifiers.tap_only}
            onChange={(event) => modifiers.set_tap_only(event.target.checked)} />
          <label htmlFor="windows-xp-tap-only"><strong>No Long Notes</strong></label>
        </div>
      </fieldset>}

      {mode === "osu" && <fieldset>
        <legend>osu!standard</legend>
        <div className="windows-xp-modifier-checkbox">
          <input id="windows-xp-custom-od" type="checkbox" checked={modifiers.osu_overall_difficulty !== null}
            onChange={(event) => modifiers.set_osu_overall_difficulty(event.target.checked
              ? settings.osu_overall_difficulty.default : null)} />
          <label htmlFor="windows-xp-custom-od"><strong>Customize Overall Difficulty</strong></label>
        </div>
        {modifiers.osu_overall_difficulty !== null && <ModifierSlider definition={settings.osu_overall_difficulty}
          label="Overall Difficulty" value={modifiers.osu_overall_difficulty}
          output={modifiers.osu_overall_difficulty.toFixed(1)} onChange={modifiers.set_osu_overall_difficulty} />}
        <div className="windows-xp-modifier-checkbox">
          <input id="windows-xp-custom-cs" type="checkbox" checked={modifiers.osu_circle_size !== null}
            onChange={(event) => modifiers.set_osu_circle_size(event.target.checked
              ? settings.osu_circle_size.default : null)} />
          <label htmlFor="windows-xp-custom-cs"><strong>Customize Circle Size</strong></label>
        </div>
        {modifiers.osu_circle_size !== null && <ModifierSlider definition={settings.osu_circle_size}
          label="Circle Size" value={modifiers.osu_circle_size} output={modifiers.osu_circle_size.toFixed(1)}
          onChange={modifiers.set_osu_circle_size} />}
        <div className="windows-xp-modifier-checkbox">
          <input id="windows-xp-custom-ar" type="checkbox" checked={modifiers.osu_approach_rate !== null}
            onChange={(event) => modifiers.set_osu_approach_rate(event.target.checked
              ? settings.osu_approach_rate.default : null)} />
          <label htmlFor="windows-xp-custom-ar"><strong>Customize Approach Rate</strong></label>
        </div>
        {modifiers.osu_approach_rate !== null && <ModifierSlider definition={settings.osu_approach_rate}
          label="Approach Rate" value={modifiers.osu_approach_rate} output={modifiers.osu_approach_rate.toFixed(1)}
          onChange={modifiers.set_osu_approach_rate} />}
      </fieldset>}

      {!mode && <p>Select an osu!standard or osu!mania chart to configure its modifiers.</p>}
    </section>
  );
}
