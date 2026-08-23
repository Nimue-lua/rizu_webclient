import { useState } from "react";
import { HttpGameplayLoader, type GameplayData } from "../library/GameplayLoader";
import { SqliteLibrary } from "../library/Library";
import { ChartSelector } from "../select/ChartSelector";
import { GameplayScreen } from "./GameplayScreen";
import { LoadingScreen } from "./LoadingScreen";
import { ResultScreen } from "./ResultScreen";
import { SettingsScreen } from "./SettingsScreen";
import { SongSelectScreen } from "./SongSelectScreen";
import type { HitRegistration } from "../gameplay/RhythmEngine";
import type { ScoreResult } from "../gameplay/scoring/ScoreEngine";

type Screen = "song-select" | "loading" | "gameplay" | "result";
const MASTER_VOLUME_KEY = "rizu.master-volume";
const SCROLL_SPEED_KEY = "rizu.scroll-speed";
const HIT_REGISTRATION_KEY = "rizu.hit-registration";
const gameplay_loader = new HttpGameplayLoader();
const chart_selector = new ChartSelector(new SqliteLibrary());

export function App() {
  const [screen, setScreen] = useState<Screen>("song-select");
  const [settings_open, setSettingsOpen] = useState(false);
  const [audio_context, setAudioContext] = useState<AudioContext | null>(null);
  const [assets, setAssets] = useState<GameplayData | null>(null);
  const [loading_chart_id, setLoadingChartId] = useState<string | null>(null);
  const [input_bindings, setInputBindings] = useState<readonly (string | null)[]>([]);
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [master_volume, setMasterVolume] = useState(() => {
    const stored_setting = localStorage.getItem(MASTER_VOLUME_KEY);
    const stored_value = stored_setting === null ? Number.NaN : Number(stored_setting);
    return Number.isFinite(stored_value) && stored_value >= 0 && stored_value <= 1 ? stored_value : 0.2;
  });
  const [scroll_speed, setScrollSpeed] = useState(() => {
    const stored_setting = localStorage.getItem(SCROLL_SPEED_KEY);
    const stored_value = stored_setting === null ? Number.NaN : Number(stored_setting);
    return Number.isFinite(stored_value) && stored_value >= 0.05 && stored_value <= 3 ? stored_value : 1;
  });
  const [hit_registration, setHitRegistration] = useState<HitRegistration>(() =>
    localStorage.getItem(HIT_REGISTRATION_KEY) === "nearest" ? "nearest" : "earliest");

  const changeMasterVolume = (value: number) => {
    localStorage.setItem(MASTER_VOLUME_KEY, String(value));
    setMasterVolume(value);
  };

  const changeScrollSpeed = (value: number) => {
    localStorage.setItem(SCROLL_SPEED_KEY, String(value));
    setScrollSpeed(value);
  };

  const changeHitRegistration = (value: HitRegistration) => {
    localStorage.setItem(HIT_REGISTRATION_KEY, value);
    setHitRegistration(value);
  };

  const beginLoading = (chart_id: string, chart_input_bindings: readonly (string | null)[]) => {
    setLoadingChartId(chart_id);
    setInputBindings(chart_input_bindings);
    setAudioContext(new AudioContext());
    setScore(null);
    setScreen("loading");
  };

  const cancelLoading = () => {
    if (audio_context) {
      void audio_context.close();
    }

    setAudioContext(null);
    setLoadingChartId(null);
    setScreen("song-select");
  };

  const finishLoading = (loaded_assets: GameplayData) => {
    setAssets(loaded_assets);
    setScreen("gameplay");
  };

  const leaveResults = () => {
    if (audio_context) {
      void audio_context.close();
    }

    setAssets(null);
    setScore(null);
    setAudioContext(null);
    setLoadingChartId(null);
    setScreen("song-select");
  };

  switch (screen) {
    case "gameplay":
      if (!assets) {
        throw new Error("Gameplay assets are not loaded");
      }

      return (
        <GameplayScreen
          assets={assets}
          master_volume={master_volume}
          scroll_speed={scroll_speed}
          input_bindings={input_bindings}
          hit_registration={hit_registration}
          onFinish={(gameplay_score) => {
            setScore(gameplay_score);
            setScreen("result");
          }}
        />
      );
    case "loading":
      if (!audio_context || !loading_chart_id) {
        throw new Error("Gameplay loading is not initialized");
      }

      return (
        <LoadingScreen
          gameplay_loader={gameplay_loader}
          chart_id={loading_chart_id}
          audio_context={audio_context}
          onCancel={cancelLoading}
          onLoaded={finishLoading}
        />
      );
    case "result":
      return <ResultScreen score={score} onExit={leaveResults} />;
    case "song-select":
      return (
        <>
          <SongSelectScreen
            chart_selector={chart_selector}
            master_volume={master_volume}
            scroll_speed={scroll_speed}
            onPlay={beginLoading}
            onSettings={() => setSettingsOpen(true)}
            onScrollSpeedChange={changeScrollSpeed}
          />
          {settings_open && (
            <SettingsScreen
              master_volume={master_volume}
              scroll_speed={scroll_speed}
              hit_registration={hit_registration}
              onMasterVolumeChange={changeMasterVolume}
              onScrollSpeedChange={changeScrollSpeed}
              onHitRegistrationChange={changeHitRegistration}
              onExit={() => setSettingsOpen(false)}
            />
          )}
        </>
      );
  }
}
