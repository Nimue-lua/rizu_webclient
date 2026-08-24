import { useEffect, type CSSProperties } from "react";
import { Gamepad2, Settings, Undo2, Volume2 } from "lucide-react";
import type { ManiaHitRegistration } from "../gameplay/ManiaRulesEngine";
import {
  scrollSpeedToCanonical,
  scrollSpeedToDisplay,
  type ScrollSpeedType,
} from "../gameplay/ScrollSpeed";

interface SettingsScreenProps {
  master_volume: number;
  music_offset: number;
  scroll_speed: number;
  scroll_speed_type: ScrollSpeedType;
  hit_registration: ManiaHitRegistration;
  onMasterVolumeChange: (master_volume: number) => void;
  onMusicOffsetChange: (music_offset: number) => void;
  onScrollSpeedChange: (scroll_speed: number) => void;
  onScrollSpeedTypeChange: (scroll_speed_type: ScrollSpeedType) => void;
  onHitRegistrationChange: (hit_registration: ManiaHitRegistration) => void;
  onExit: () => void;
}

function sliderStyle(value: number, minimum: number, maximum: number): CSSProperties {
  return { "--slider-progress": `${((value - minimum) / (maximum - minimum)) * 100}%` } as CSSProperties;
}

export function SettingsScreen({
  master_volume,
  music_offset,
  scroll_speed,
  scroll_speed_type,
  hit_registration,
  onMasterVolumeChange,
  onMusicOffsetChange,
  onScrollSpeedChange,
  onScrollSpeedTypeChange,
  onHitRegistrationChange,
  onExit,
}: SettingsScreenProps) {
  useEffect(() => {
    const resizeUi = () => {
      const scale = window.innerHeight / 1080;
      document.documentElement.style.setProperty("--ui-scale", String(scale));
      document.documentElement.style.setProperty("--logical-width", `${window.innerWidth / scale}px`);
    };

    window.addEventListener("resize", resizeUi);
    resizeUi();
    return () => window.removeEventListener("resize", resizeUi);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onExit();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onExit]);

  const master_volume_percent = Math.round(master_volume * 100);
  const displayed_scroll_speed = scrollSpeedToDisplay(scroll_speed_type, scroll_speed);
  const scroll_speed_range = scroll_speed_type === "osu"
    ? { minimum: 1, maximum: 40, step: 1 }
    : { minimum: 0.05, maximum: 3, step: 0.05 };

  return (
    <div className="settings-modal-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onExit();
    }}>
      <main className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <aside className="settings-sidebar">
        <div className="settings-brand">
          <img src="/rizu-logo.svg" alt="" />
          <span>SETTINGS</span>
        </div>
        <nav aria-label="Settings sections">
          <a href="#settings-all"><Settings aria-hidden="true" />All</a>
          <a href="#audio-volume"><Volume2 aria-hidden="true" />Audio Volume</a>
          <a href="#gameplay-settings"><Gamepad2 aria-hidden="true" />Gameplay</a>
        </nav>
        <button className="settings-back" type="button" onClick={onExit}>
          <Undo2 aria-hidden="true" />
          <span>BACK</span>
        </button>
      </aside>

      <section className="settings-panel" id="settings-all">
        <header className="settings-heading" id="audio-volume">
          <Volume2 aria-hidden="true" />
          <h1 id="settings-title">Audio Volume</h1>
        </header>
        <label className="settings-control" htmlFor="master-volume">
          <span>Master volume <output htmlFor="master-volume">{master_volume_percent}%</output></span>
          <input
            id="master-volume"
            type="range"
            min="0"
            max="100"
            step="1"
            value={master_volume_percent}
            style={sliderStyle(master_volume_percent, 0, 100)}
            onChange={(event) => onMasterVolumeChange(Number(event.target.value) / 100)}
          />
          <small>Controls preview and gameplay audio.</small>
        </label>
        <label className="settings-control" htmlFor="music-offset">
          <span>Music offset <output htmlFor="music-offset">{music_offset} ms</output></span>
          <input
            id="music-offset"
            type="range"
            min="-200"
            max="200"
            step="1"
            value={music_offset}
            style={sliderStyle(music_offset, -200, 200)}
            onChange={(event) => onMusicOffsetChange(Number(event.target.value))}
          />
          <small>Positive values delay the music relative to the notes.</small>
        </label>

        <header className="settings-heading settings-heading-spaced" id="gameplay-settings">
          <Gamepad2 aria-hidden="true" />
          <h2>Gameplay</h2>
        </header>
        <label className="settings-control" htmlFor="settings-scroll-speed-type">
          <span>Scroll speed type</span>
          <select id="settings-scroll-speed-type" value={scroll_speed_type}
            onChange={(event) => onScrollSpeedTypeChange(event.target.value as ScrollSpeedType)}>
            <option value="default">Rizu</option>
            <option value="osu">osu!</option>
          </select>
          <small>Chooses the scale used by the scroll speed slider.</small>
        </label>
        <label className="settings-control" htmlFor="settings-scroll-speed">
          <span>Scroll speed <output htmlFor="settings-scroll-speed">
            {scroll_speed_type === "osu" ? displayed_scroll_speed : `${displayed_scroll_speed.toFixed(2)}x`}
          </output></span>
          <input
            id="settings-scroll-speed"
            type="range"
            min={scroll_speed_range.minimum}
            max={scroll_speed_range.maximum}
            step={scroll_speed_range.step}
            value={displayed_scroll_speed}
            style={sliderStyle(displayed_scroll_speed, scroll_speed_range.minimum, scroll_speed_range.maximum)}
            onChange={(event) => onScrollSpeedChange(
              scrollSpeedToCanonical(scroll_speed_type, Number(event.target.value)))}
          />
          <small>Multiplies the visual-time scroll distance.</small>
        </label>
        <label className="settings-control" htmlFor="settings-hit-registration">
          <span>Hit registration</span>
          <select id="settings-hit-registration" value={hit_registration}
            onChange={(event) => onHitRegistrationChange(event.target.value as ManiaHitRegistration)}>
            <option value="earliest">Earliest note</option>
            <option value="nearest">Nearest note</option>
          </select>
          <small>Chooses between the first active note and the note nearest to the music time.</small>
        </label>
        </section>
      </main>
    </div>
  );
}
