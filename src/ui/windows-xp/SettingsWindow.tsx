import { appSettings, settings, useSetting } from "../../config/Settings";

interface SettingsSliderProps {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  output: string;
  onChange: (value: number) => void;
}

function SettingsSlider({ id, label, min, max, step, value, output, onChange }: SettingsSliderProps) {
  return (
    <div className="windows-xp-settings-control">
      <div>
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{output}</output>
      </div>
      <div className="windows-xp-settings-slider">
        <span aria-hidden="true">Low</span>
        <input id={id} type="range" min={min} max={max} step={step} value={value}
          onChange={(event) => onChange(Number(event.target.value))} />
        <span aria-hidden="true">High</span>
      </div>
    </div>
  );
}

export function SettingsWindow() {
  const master_volume = useSetting(settings.master_volume);
  const hit_sound_volume = useSetting(settings.osu_hit_sound_volume);
  const music_offset = useSetting(settings.music_offset);

  return (
    <section className="windows-xp-settings">
      <header className="windows-xp-settings-intro">
        <div className="windows-xp-settings-icon" aria-hidden="true">♫</div>
        <div>
          <strong>Sound and Gameplay Settings</strong>
          <p>Adjust music volume, osu! hit sounds, and music timing.</p>
        </div>
      </header>

      <fieldset>
        <legend>Volume</legend>
        <SettingsSlider id="windows-xp-music-volume" label="Music volume" min={0} max={100} step={1}
          value={Math.round(master_volume * 100)} output={`${Math.round(master_volume * 100)}%`}
          onChange={(value) => appSettings.set(settings.master_volume, value / 100)} />
        <SettingsSlider id="windows-xp-hit-sound-volume" label="osu! hit sounds" min={0} max={100} step={1}
          value={Math.round(hit_sound_volume * 100)} output={`${Math.round(hit_sound_volume * 100)}%`}
          onChange={(value) => appSettings.set(settings.osu_hit_sound_volume, value / 100)} />
      </fieldset>

      <fieldset>
        <legend>Timing</legend>
        <SettingsSlider id="windows-xp-music-offset" label="Music offset" min={-200} max={200} step={1}
          value={music_offset} output={`${music_offset} ms`}
          onChange={(value) => appSettings.set(settings.music_offset, value)} />
        <p className="windows-xp-settings-help">Use a positive value if notes appear too early, or a negative value if they appear too late.</p>
      </fieldset>

      <footer>
        <span>Changes are saved automatically.</span>
        <button type="button" onClick={() => {
          appSettings.set(settings.master_volume, settings.master_volume.default);
          appSettings.set(settings.osu_hit_sound_volume, settings.osu_hit_sound_volume.default);
          appSettings.set(settings.music_offset, settings.music_offset.default);
        }}>Restore Defaults</button>
      </footer>
    </section>
  );
}
