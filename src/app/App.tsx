import { useState, type PropsWithChildren } from "react";
import { HttpGameplayLoader, type GameplayData, type GameplayLocation } from "../library/GameplayLoader";
import { SqliteLibrary } from "../library/Library";
import type { Chartview } from "../library/views";
import { ChartSelector } from "../select/ChartSelector";
import { GameplayScreen } from "./GameplayScreen";
import { LoadingScreen } from "./LoadingScreen";
import { ResultScreen } from "./ResultScreen";
import { SettingsScreen } from "./SettingsScreen";
import { SongSelectScreen } from "./SongSelectScreen";
import type { ManiaHitRegistration } from "../gameplay/ManiaRulesEngine";
import type { ScoreResult } from "../gameplay/scoring/ScoreResult";
import type { ScrollSpeedType } from "../gameplay/ScrollSpeed";
import { ReplayBase } from "../replay/ReplayBase";
import {
  loadNoteSkinSelections,
  saveNoteSkinSelections,
  selectedNoteSkin,
  type NoteSkinSelections,
} from "../gameplay/renderer/NoteSkinSelection";
import { destroyNoteSkin } from "../gameplay/renderer/NoteSkin";

type Screen = "song-select" | "loading" | "gameplay" | "result";
const MASTER_VOLUME_KEY = "rizu.master-volume";
const MUSIC_OFFSET_KEY = "rizu.music-offset";
const SCROLL_SPEED_KEY = "rizu.scroll-speed";
const SCROLL_SPEED_TYPE_KEY = "rizu.scroll-speed-type";
const HIT_REGISTRATION_KEY = "rizu.hit-registration";
const MUSIC_RATE_KEY = "rizu.music-rate";
const CONSTANT_SCROLL_KEY = "rizu.constant-scroll-speed";
const TAP_ONLY_KEY = "rizu.no-long-notes";
const gameplay_loader = new HttpGameplayLoader();
const chart_selector = new ChartSelector(new SqliteLibrary());

function ScreenTransition({ children }: PropsWithChildren) {
  return <div className="screen-transition">{children}</div>;
}

export function App() {
  const [screen, setScreen] = useState<Screen>("song-select");
  const [settings_open, setSettingsOpen] = useState(false);
  const [audio_context, setAudioContext] = useState<AudioContext | null>(null);
  const [assets, setAssets] = useState<GameplayData | null>(null);
  const [loading_location, setLoadingLocation] = useState<GameplayLocation | null>(null);
  const [input_bindings, setInputBindings] = useState<readonly (string | null)[]>([]);
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [note_skin_selections, setNoteSkinSelections] = useState(loadNoteSkinSelections);
  const [master_volume, setMasterVolume] = useState(() => {
    const stored_setting = localStorage.getItem(MASTER_VOLUME_KEY);
    const stored_value = stored_setting === null ? Number.NaN : Number(stored_setting);
    return Number.isFinite(stored_value) && stored_value >= 0 && stored_value <= 1 ? stored_value : 0.2;
  });
  const [music_offset, setMusicOffset] = useState(() => {
    const stored_setting = localStorage.getItem(MUSIC_OFFSET_KEY);
    const stored_value = stored_setting === null ? Number.NaN : Number(stored_setting);
    return Number.isFinite(stored_value) && stored_value >= -200 && stored_value <= 200 ? stored_value : 0;
  });
  const [scroll_speed, setScrollSpeed] = useState(() => {
    const stored_setting = localStorage.getItem(SCROLL_SPEED_KEY);
    const stored_value = stored_setting === null ? Number.NaN : Number(stored_setting);
    return Number.isFinite(stored_value) && stored_value >= 0.05 && stored_value <= 3 ? stored_value : 1;
  });
  const [scroll_speed_type, setScrollSpeedType] = useState<ScrollSpeedType>(() =>
    localStorage.getItem(SCROLL_SPEED_TYPE_KEY) === "osu" ? "osu" : "default");
  const [hit_registration, setHitRegistration] = useState<ManiaHitRegistration>(() =>
    localStorage.getItem(HIT_REGISTRATION_KEY) === "nearest" ? "nearest" : "earliest");
  const [replay_base, setReplayBase] = useState(() => {
    const replay_base = new ReplayBase();
    const stored_setting = localStorage.getItem(MUSIC_RATE_KEY);
    const stored_value = stored_setting === null ? Number.NaN : Number(stored_setting);
    if (Number.isFinite(stored_value) && stored_value >= 0.25 && stored_value <= 4) replay_base.rate = stored_value;
    replay_base.const = localStorage.getItem(CONSTANT_SCROLL_KEY) === "true";
    replay_base.tap_only = localStorage.getItem(TAP_ONLY_KEY) === "true";
    return replay_base;
  });

  const changeMasterVolume = (value: number) => {
    localStorage.setItem(MASTER_VOLUME_KEY, String(value));
    setMasterVolume(value);
  };

  const changeMusicOffset = (value: number) => {
    const offset = Math.min(200, Math.max(-200, Math.round(value)));
    localStorage.setItem(MUSIC_OFFSET_KEY, String(offset));
    setMusicOffset(offset);
  };

  const changeScrollSpeed = (value: number) => {
    localStorage.setItem(SCROLL_SPEED_KEY, String(value));
    setScrollSpeed(value);
  };

  const changeScrollSpeedType = (value: ScrollSpeedType) => {
    localStorage.setItem(SCROLL_SPEED_TYPE_KEY, value);
    setScrollSpeedType(value);
  };

  const changeHitRegistration = (value: ManiaHitRegistration) => {
    localStorage.setItem(HIT_REGISTRATION_KEY, value);
    setHitRegistration(value);
  };

  const changeMusicRate = (value: number) => {
    const rate = Math.round(value * 1000) / 1000;
    localStorage.setItem(MUSIC_RATE_KEY, String(rate));
    setReplayBase((current) => {
      const next = new ReplayBase();
      next.importReplayBase(current.exportReplayBase());
      next.rate = rate;
      return next;
    });
  };

  const changeConstantScroll = (value: boolean) => {
    localStorage.setItem(CONSTANT_SCROLL_KEY, String(value));
    setReplayBase((current) => {
      const next = new ReplayBase();
      next.importReplayBase(current.exportReplayBase());
      next.const = value;
      return next;
    });
  };

  const changeTapOnly = (value: boolean) => {
    localStorage.setItem(TAP_ONLY_KEY, String(value));
    setReplayBase((current) => {
      const next = new ReplayBase();
      next.importReplayBase(current.exportReplayBase());
      next.tap_only = value;
      return next;
    });
  };

  const beginLoading = (chart: Chartview, chart_input_bindings: readonly (string | null)[], song: { title: string; artist: string }) => {
    const note_skin = selectedNoteSkin(chart.mode === 3 ? "mania" : String(chart.mode), chart.keys ?? 0, note_skin_selections);
    setLoadingLocation({
      audio_url: chart.audio_url,
      artist: song.artist,
      background_url: chart.background_url,
      bpm: chart.bpm_avg,
      chart_name: chart.name,
      chart_url: chart.chart_url,
      difficulty: chart.difficulty,
      duration_seconds: chart.duration_seconds,
      long_note_ratio: chart.long_note_ratio,
      note_skin_url: chart.mode === 0 ? "/skins/dont_commit.osk" : note_skin?.url ?? null,
      title: song.title,
    });
    setInputBindings(chart_input_bindings);
    setAudioContext(new AudioContext());
    setScore(null);
    setScreen("loading");
  };

  const changeNoteSkinSelection = (key: string, skin_id: string | undefined) => {
    setNoteSkinSelections((current) => {
      const next: NoteSkinSelections = { ...current, [key]: skin_id ?? "" };
      saveNoteSkinSelections(next);
      return next;
    });
  };

  const cancelLoading = () => {
    if (audio_context) {
      void audio_context.close();
    }

    setAudioContext(null);
    setLoadingLocation(null);
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

    if (assets) destroyNoteSkin(assets.note_skin);
    setAssets(null);
    setScore(null);
    setAudioContext(null);
    setLoadingLocation(null);
    setScreen("song-select");
  };

  switch (screen) {
    case "gameplay":
      if (!assets) {
        throw new Error("Gameplay assets are not loaded");
      }

      return (
        <ScreenTransition key="gameplay">
          <GameplayScreen
            assets={assets}
            master_volume={master_volume}
            music_offset={music_offset}
            scroll_speed={scroll_speed}
            replay_base={replay_base}
            input_bindings={input_bindings}
            hit_registration={hit_registration}
            onFinish={(gameplay_score) => {
              setScore(gameplay_score);
              setScreen("result");
            }}
          />
        </ScreenTransition>
      );
    case "loading":
      if (!audio_context || !loading_location) {
        throw new Error("Gameplay loading is not initialized");
      }

      return (
        <ScreenTransition key="loading">
          <LoadingScreen
            gameplay_loader={gameplay_loader}
            location={loading_location}
            audio_context={audio_context}
            onCancel={cancelLoading}
            onLoaded={finishLoading}
          />
        </ScreenTransition>
      );
    case "result":
      return (
        <ScreenTransition key="result">
          <ResultScreen
            score={score}
            background_url={loading_location?.background_url ?? null}
            title={loading_location?.title ?? "Unknown title"}
            artist={loading_location?.artist ?? "Unknown artist"}
            chart_name={loading_location?.chart_name ?? "Unknown chart"}
            duration_seconds={loading_location?.duration_seconds ?? 0}
            long_note_ratio={loading_location?.long_note_ratio ?? 0}
            bpm={loading_location?.bpm ?? 0}
            music_rate={replay_base.rate}
            difficulty={loading_location?.difficulty ?? 0}
            overall_difficulty={assets?.chart.overall_difficulty ?? 5}
            mode={assets?.mode ?? "mania"}
            onExit={leaveResults}
          />
        </ScreenTransition>
      );
    case "song-select":
      return (
        <ScreenTransition key="song-select">
          <SongSelectScreen
            chart_selector={chart_selector}
            master_volume={master_volume}
            music_rate={replay_base.rate}
            constant_scroll={replay_base.const}
            tap_only={replay_base.tap_only}
            note_skin_selections={note_skin_selections}
            onPlay={beginLoading}
            onSettings={() => setSettingsOpen(true)}
            onMusicRateChange={changeMusicRate}
            onConstantScrollChange={changeConstantScroll}
            onTapOnlyChange={changeTapOnly}
            onNoteSkinSelectionChange={changeNoteSkinSelection}
          />
          {settings_open && (
            <SettingsScreen
              master_volume={master_volume}
              music_offset={music_offset}
              scroll_speed={scroll_speed}
              scroll_speed_type={scroll_speed_type}
              hit_registration={hit_registration}
              onMasterVolumeChange={changeMasterVolume}
              onMusicOffsetChange={changeMusicOffset}
              onScrollSpeedChange={changeScrollSpeed}
              onScrollSpeedTypeChange={changeScrollSpeedType}
              onHitRegistrationChange={changeHitRegistration}
              onExit={() => setSettingsOpen(false)}
            />
          )}
        </ScreenTransition>
      );
  }
}
