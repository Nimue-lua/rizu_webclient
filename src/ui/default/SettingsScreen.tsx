import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type UIEvent } from "react";
import {
  Database,
  Gauge,
  Image,
  Play,
  Trash2,
  UserRound,
  Volume2,
} from "lucide-react";
import type { ManiaHitRegistration } from "../../gameplay/mania/ManiaRulesEngine";
import {
  scrollSpeedToCanonical,
  scrollSpeedToDisplay,
} from "../../gameplay/mania/ScrollSpeed";
import type { OsuCursorRendererMode } from "../../gameplay/osu/OsuHardwareCursor";
import type { HitErrorMeterType } from "../../gameplay/renderer/GameplayHudRenderer";
import { appSettings, settings, useSetting, type UserInterface } from "../../config/Settings";
import { currentUser, login, logout, register, subscribeAccountChanges, type OnlineUser } from "../../replay/ReplayServer";
import { ConfigResetButton } from "./ConfigResetButton";
import { RangeInput } from "./RangeInput";

interface SettingsScreenProps {
  onDeleteScores: () => Promise<void>;
  onExit: () => void;
}

type SettingsSection = "audio" | "gameplay" | "offset" | "renderer" | "online" | "data";

const sections: { id: SettingsSection; label: string; icon: ReactNode }[] = [
  { id: "audio", label: "Audio Volume", icon: <Volume2 aria-hidden="true" /> },
  { id: "gameplay", label: "Gameplay", icon: <Play aria-hidden="true" /> },
  { id: "offset", label: "Offset", icon: <Gauge aria-hidden="true" /> },
  { id: "renderer", label: "Renderer", icon: <Image aria-hidden="true" /> },
  { id: "online", label: "Online", icon: <UserRound aria-hidden="true" /> },
  { id: "data", label: "Local Data", icon: <Database aria-hidden="true" /> },
];

function sliderStyle(value: number, minimum: number, maximum: number): CSSProperties {
  return { "--slider-progress": `${((value - minimum) / (maximum - minimum)) * 100}%` } as CSSProperties;
}

export function SettingsScreen({
  onDeleteScores,
  onExit,
}: SettingsScreenProps) {
  const master_volume = useSetting(settings.master_volume);
  const user_interface = useSetting(settings.user_interface);
  const osu_hit_sound_volume = useSetting(settings.osu_hit_sound_volume);
  const music_offset = useSetting(settings.music_offset);
  const scroll_speed = useSetting(settings.scroll_speed);
  const scroll_speed_type = useSetting(settings.scroll_speed_type);
  const cursor_scale = useSetting(settings.cursor_scale);
  const hit_error_meter = useSetting(settings.hit_error_meter);
  const hit_error_meter_type = useSetting(settings.hit_error_meter_type);
  const hit_error_meter_scale = useSetting(settings.hit_error_meter_scale);
  const osu_cursor_renderer = useSetting(settings.osu_cursor_renderer);
  const osu_raw_input = useSetting(settings.osu_raw_input);
  const hit_registration = useSetting(settings.mania_hit_registration);
  const online_server_address = useSetting(settings.online_server_address);
  const [selected_section, setSelectedSection] = useState<SettingsSection>("audio");
  const [online_user, setOnlineUser] = useState<OnlineUser | null>(null);
  const [account_name, setAccountName] = useState("");
  const [account_password, setAccountPassword] = useState("");
  const [account_error, setAccountError] = useState("");
  const [account_busy, setAccountBusy] = useState(false);
  const [server_address, setServerAddress] = useState(online_server_address);
  const panel_ref = useRef<HTMLElement>(null);

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

  useEffect(() => {
    const refresh = () => void currentUser().then(setOnlineUser).catch(() => setOnlineUser(null));
    refresh();
    return subscribeAccountChanges(refresh);
  }, []);

  useEffect(() => setServerAddress(online_server_address), [online_server_address]);

  const saveServerAddress = () => {
    appSettings.set(settings.online_server_address, server_address.trim());
  };

  const authenticate = async (action: typeof login) => {
    setAccountBusy(true);
    setAccountError("");
    try {
      const user = await action(account_name, account_password);
      setOnlineUser(user);
      setAccountPassword("");
    } catch (reason) {
      setAccountError(reason instanceof Error ? reason.message : "Account request failed");
    } finally {
      setAccountBusy(false);
    }
  };

  const master_volume_percent = Math.round(master_volume * 100);
  const osu_hit_sound_volume_percent = Math.round(osu_hit_sound_volume * 100);
  const displayed_scroll_speed = scrollSpeedToDisplay(scroll_speed_type, scroll_speed);
  const scroll_speed_range = scroll_speed_type === "osu"
    ? { minimum: 1, maximum: 40, step: 1 }
    : { minimum: 0.05, maximum: 3, step: 0.01 };
  const selectSection = (section: SettingsSection) => {
    setSelectedSection(section);
    document.getElementById(`settings-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const syncSelectedSection = (event: UIEvent<HTMLElement>) => {
    const panel = event.currentTarget;
    if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 1) {
      setSelectedSection(sections.at(-1)!.id);
      return;
    }

    const panel_top = panel.getBoundingClientRect().top;
    let current_section = sections[0].id;
    for (const section of sections) {
      const element = document.getElementById(`settings-${section.id}`);
      if (element && element.getBoundingClientRect().top <= panel_top + 32) current_section = section.id;
    }
    setSelectedSection(current_section);
  };

  return (
    <div className="settings-modal-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onExit();
    }}>
      <main className="settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
        <aside className="settings-sidebar">
          <nav aria-label="Settings sections">
            {sections.map((section) => (
              <button
                className={selected_section === section.id ? "selected" : ""}
                type="button"
                key={section.id}
                onClick={() => selectSection(section.id)}
              >
                {section.icon}
                <span>{section.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <section className="settings-panel" ref={panel_ref} onScroll={syncSelectedSection}>
          <section className="settings-section" id="settings-audio">
              <header className="settings-heading">
                <Volume2 aria-hidden="true" />
                <h1>Audio Volume</h1>
              </header>
              <div className="settings-control settings-slider-control">
                <div className="config-control-label"><ConfigResetButton label="Reset Master volume to default"
                  onReset={() => appSettings.set(settings.master_volume, settings.master_volume.default)} />
                  <label htmlFor="master-volume">Master volume&nbsp;&nbsp;<output>{master_volume_percent}%</output></label></div>
                <RangeInput id="master-volume" min={0} max={100} step={1}
                  value={master_volume_percent} style={sliderStyle(master_volume_percent, 0, 100)}
                  onValueChange={(value) => appSettings.set(settings.master_volume, value / 100)} />
              </div>
              <div className="settings-control settings-slider-control">
                <div className="config-control-label"><ConfigResetButton label="Reset osu! hit sound volume to default"
                  onReset={() => appSettings.set(settings.osu_hit_sound_volume, settings.osu_hit_sound_volume.default)} />
                  <label htmlFor="osu-hit-sound-volume">osu! hit sound volume&nbsp;&nbsp;<output>{osu_hit_sound_volume_percent}%</output></label></div>
                <RangeInput id="osu-hit-sound-volume" min={0} max={100} step={1}
                  value={osu_hit_sound_volume_percent} style={sliderStyle(osu_hit_sound_volume_percent, 0, 100)}
                  onValueChange={(value) => appSettings.set(settings.osu_hit_sound_volume, value / 100)} />
              </div>
          </section>

          <section className="settings-section" id="settings-gameplay">
              <header className="settings-heading">
                <Play aria-hidden="true" />
                <h2>Gameplay</h2>
              </header>
              <div className="settings-control settings-segmented-control">
                <span>Scroll speed type</span>
                <div role="group" aria-label="Scroll speed type">
                  <button type="button" className={scroll_speed_type === "default" ? "selected" : ""}
                    onClick={() => appSettings.set(settings.scroll_speed_type, "default")}>Rizu</button>
                  <button type="button" className={scroll_speed_type === "osu" ? "selected" : ""}
                    onClick={() => appSettings.set(settings.scroll_speed_type, "osu")}>osu!</button>
                </div>
              </div>
              <div className="settings-control settings-slider-control">
                <div className="config-control-label"><ConfigResetButton label="Reset Scroll speed to default"
                  onReset={() => appSettings.set(settings.scroll_speed, settings.scroll_speed.default)} />
                  <label htmlFor="settings-scroll-speed">Scroll speed&nbsp;&nbsp;<output>
                  {scroll_speed_type === "osu" ? displayed_scroll_speed : displayed_scroll_speed.toFixed(2)}
                </output></label></div>
                <RangeInput id="settings-scroll-speed" min={scroll_speed_range.minimum}
                  max={scroll_speed_range.maximum} step={scroll_speed_range.step} value={displayed_scroll_speed}
                  style={sliderStyle(displayed_scroll_speed, scroll_speed_range.minimum, scroll_speed_range.maximum)}
                  onValueChange={(value) => appSettings.set(settings.scroll_speed,
                    scrollSpeedToCanonical(scroll_speed_type, value))} />
              </div>
              <label className="settings-checkbox-control">
                <input type="checkbox" checked={osu_raw_input}
                  onChange={(event) => appSettings.set(settings.osu_raw_input, event.target.checked)} />
                <span aria-hidden="true" />
                <strong>osu! raw pointer input</strong>
              </label>
              <label className="settings-control settings-select-control" htmlFor="settings-mania-hit-registration">
                <span>Mania hit registration</span>
                <select id="settings-mania-hit-registration" value={hit_registration}
                  onChange={(event) => appSettings.set(settings.mania_hit_registration, event.target.value as ManiaHitRegistration)}>
                  <option value="earliest">Earliest note</option>
                  <option value="nearest">Nearest note</option>
                </select>
              </label>
          </section>

          <section className="settings-section" id="settings-offset">
              <header className="settings-heading">
                <Gauge aria-hidden="true" />
                <h2>Offset</h2>
              </header>
              <div className="settings-control settings-slider-control">
                <div className="config-control-label"><ConfigResetButton label="Reset Music offset to default"
                  onReset={() => appSettings.set(settings.music_offset, settings.music_offset.default)} />
                  <label htmlFor="music-offset">Music offset&nbsp;&nbsp;<output>{music_offset} ms</output></label></div>
                <RangeInput id="music-offset" min={-200} max={200} step={1} value={music_offset}
                  style={sliderStyle(music_offset, -200, 200)}
                  onValueChange={(value) => appSettings.set(settings.music_offset, value)} />
              </div>
          </section>

          <section className="settings-section" id="settings-renderer">
              <header className="settings-heading">
                <Image aria-hidden="true" />
                <h2>Renderer</h2>
              </header>
              <label className="settings-control settings-select-control" htmlFor="settings-user-interface">
                <span>User interface</span>
                <select id="settings-user-interface" value={user_interface} onChange={(event) => {
                  appSettings.set(settings.user_interface, event.target.value as UserInterface);
                  window.location.reload();
                }}>
                  <option value="default">Rizu</option>
                  <option value="windows-xp">Windows XP</option>
                </select>
              </label>
              <div className="settings-control settings-slider-control">
                <div className="config-control-label"><ConfigResetButton label="Reset osu! cursor scale to default"
                  onReset={() => appSettings.set(settings.cursor_scale, settings.cursor_scale.default)} />
                  <label htmlFor="settings-cursor-scale">osu! cursor scale&nbsp;&nbsp;<output>{Math.round(cursor_scale * 100)}%</output></label></div>
                <RangeInput id="settings-cursor-scale" min={25} max={200} step={5}
                  value={Math.round(cursor_scale * 100)} style={sliderStyle(cursor_scale * 100, 25, 200)}
                  onValueChange={(value) => appSettings.set(settings.cursor_scale, value / 100)} />
              </div>
              <label className="settings-control settings-select-control" htmlFor="settings-osu-cursor-renderer">
                <span>osu! cursor renderer</span>
                <select id="settings-osu-cursor-renderer" value={osu_cursor_renderer}
                  onChange={(event) => appSettings.set(settings.osu_cursor_renderer, event.target.value as OsuCursorRendererMode)}>
                  <option value="os">OS cursor (low latency)</option>
                  <option value="webgl">WebGL cursor</option>
                </select>
              </label>
              <label className="settings-checkbox-control">
                <input type="checkbox" checked={hit_error_meter}
                  onChange={(event) => appSettings.set(settings.hit_error_meter, event.target.checked)} />
                <span aria-hidden="true" />
                <strong>Enable hit error meter</strong>
              </label>
              <label className="settings-control settings-select-control" htmlFor="settings-hit-error-meter-type">
                <span>Hit error meter type</span>
                <select id="settings-hit-error-meter-type" value={hit_error_meter_type}
                  onChange={(event) => appSettings.set(settings.hit_error_meter_type, event.target.value as HitErrorMeterType)}>
                  <option value="normal">Normal</option>
                  <option value="fullscreen">Fullscreen</option>
                </select>
              </label>
              {hit_error_meter_type === "normal" && <div className="settings-control settings-slider-control">
                <div className="config-control-label"><ConfigResetButton label="Reset Hit error meter scale to default"
                  onReset={() => appSettings.set(settings.hit_error_meter_scale, settings.hit_error_meter_scale.default)} />
                  <label htmlFor="settings-hit-error-meter-scale">Hit error meter scale&nbsp;&nbsp;
                    <output>{hit_error_meter_scale.toFixed(2)}x</output></label></div>
                <RangeInput id="settings-hit-error-meter-scale" min={0.5} max={2} step={0.05}
                  value={hit_error_meter_scale} style={sliderStyle(hit_error_meter_scale, 0.5, 2)}
                  onValueChange={(value) => appSettings.set(settings.hit_error_meter_scale, value)} />
              </div>}
          </section>

          <section className="settings-section" id="settings-online">
              <header className="settings-heading">
                <UserRound aria-hidden="true" />
                <h2>Online</h2>
              </header>
              <label className="settings-control settings-text-control" htmlFor="settings-server-address">
                <span>Server address</span>
                <input id="settings-server-address" type="text" value={server_address}
                  placeholder="Same origin (default)" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  onChange={(event) => setServerAddress(event.target.value)} onBlur={saveServerAddress}
                  onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
              </label>
              {online_user ? <div className="settings-account-control">
                <span>Logged in as <strong>{online_user.name}</strong></span>
                <button type="button" onClick={() => void logout().then(() => setOnlineUser(null))}>Log out</button>
              </div> : <div className="settings-account-form">
                <label className="settings-control settings-text-control" htmlFor="settings-account-name">
                  <span>Account name</span>
                  <input id="settings-account-name" type="text" value={account_name} autoComplete="username"
                    onChange={(event) => setAccountName(event.target.value)} />
                </label>
                <label className="settings-control settings-text-control" htmlFor="settings-account-password">
                  <span>Password</span>
                  <input id="settings-account-password" type="password" value={account_password} autoComplete="current-password"
                    onChange={(event) => setAccountPassword(event.target.value)} />
                </label>
                {account_error && <p className="settings-account-error">{account_error}</p>}
                <div className="settings-account-actions">
                  <button type="button" disabled={account_busy} onClick={() => void authenticate(login)}>Log in</button>
                  <button type="button" disabled={account_busy} onClick={() => void authenticate(register)}>Register</button>
                </div>
              </div>}
          </section>

          <section className="settings-section" id="settings-data">
              <header className="settings-heading">
                <Database aria-hidden="true" />
                <h2>Local Data</h2>
              </header>
              <div className="settings-danger-control">
                <span>Scores and replays</span>
                <button type="button" onClick={() => {
                  if (window.confirm("Delete all local scores and replays? This cannot be undone.")) void onDeleteScores();
                }}><Trash2 aria-hidden="true" />Delete all local scores</button>
              </div>
          </section>
        </section>
      </main>
    </div>
  );
}
