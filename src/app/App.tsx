import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import { HttpGameplayLoader, type GameplayData, type GameplayLocation } from "../library/GameplayLoader";
import { SqliteLibrary } from "../library/Library";
import type { Chartview } from "../library/views";
import { ChartSelector } from "../select/ChartSelector";
import { GameplayScreen } from "./GameplayScreen";
import { LoadingScreen } from "./LoadingScreen";
import { ResultScreen } from "./ResultScreen";
import { SettingsScreen } from "./SettingsScreen";
import { SongSelectScreen } from "./SongSelectScreen";
import { WelcomeScreen } from "./WelcomeScreen";
import { UnlockingFpsScreen } from "./UnlockingFpsScreen";
import { OszSelectScreen } from "./OszSelectScreen";
import { readOszArchive, type OszArchive } from "../library/OszArchive";
import type { ManiaHitRegistration } from "../gameplay/mania/ManiaRulesEngine";
import type { ScoreResult } from "../gameplay/scoring/ScoreResult";
import type { ScrollSpeedType } from "../gameplay/mania/ScrollSpeed";
import { ManiaReplayBase } from "../replay/mania/ManiaReplayBase";
import {
  loadNoteSkinSelections,
  noteSkinMode,
  note_skin_options,
  saveNoteSkinSelections,
  selectedNoteSkin,
  type NoteSkinOption,
  type NoteSkinSelections,
} from "../gameplay/renderer/NoteSkinSelection";
import { destroyNoteSkin } from "../gameplay/renderer/NoteSkin";
import { DEFAULT_OSU_SKIN_URL } from "../gameplay/renderer/OsuSkin";
import {
  inspectLocalNoteSkin,
  loadLocalNoteSkins,
  localNoteSkinOptions,
  saveLocalNoteSkin,
  shouldPersistLocalNoteSkin,
} from "../gameplay/renderer/LocalNoteSkinStore";
import { osuSliderRendererMode, type OsuSliderRendererMode } from "../gameplay/osu/rendering/WebGlSliderGraphics";
import { osuCursorRendererMode, type OsuCursorRendererMode } from "../gameplay/osu/OsuHardwareCursor";
import { savePlay, storedPlay } from "../replay/ReplayStore";
import type { CompletedGameplay } from "../replay/RecordedReplay";

type Screen = "welcome" | "unlocking-fps" | "song-select" | "osz-select" | "loading" | "gameplay" | "result";
const MASTER_VOLUME_KEY = "rizu.master-volume";
const OSU_HIT_SOUND_VOLUME_KEY = "rizu.osu-hit-sound-volume";
const MUSIC_OFFSET_KEY = "rizu.music-offset";
const SCROLL_SPEED_KEY = "rizu.scroll-speed";
const SCROLL_SPEED_TYPE_KEY = "rizu.scroll-speed-type";
const CURSOR_SCALE_KEY = "rizu.cursor-scale";
const OSU_CURSOR_RENDERER_KEY = "rizu.osu-cursor-renderer";
const OSU_RAW_INPUT_KEY = "rizu.osu-raw-input";
const OSU_SLIDER_RENDERER_KEY = "rizu.osu-slider-renderer";
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
  const [screen, setScreen] = useState<Screen>("welcome");
  const [settings_open, setSettingsOpen] = useState(false);
  const [audio_context, setAudioContext] = useState<AudioContext | null>(null);
  const [assets, setAssets] = useState<GameplayData | null>(null);
  const [loading_location, setLoadingLocation] = useState<GameplayLocation | null>(null);
  const [loading_return_screen, setLoadingReturnScreen] = useState<"song-select" | "osz-select">("song-select");
  const [osz_archive, setOszArchive] = useState<OszArchive | null>(null);
  const osz_archive_ref = useRef<OszArchive | null>(null);
  const [osz_importing, setOszImporting] = useState(false);
  const [osz_import_error, setOszImportError] = useState<string | null>(null);
  const [input_bindings, setInputBindings] = useState<readonly (string | null)[]>([]);
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [completed_gameplay, setCompletedGameplay] = useState<CompletedGameplay | null>(null);
  const [playback, setPlayback] = useState<CompletedGameplay | null>(null);
  const [note_skin_selections, setNoteSkinSelections] = useState(loadNoteSkinSelections);
  const [available_note_skins, setAvailableNoteSkins] = useState<readonly NoteSkinOption[]>(note_skin_options);
  const local_skin_urls = useRef(new Map<string, string>());
  const [master_volume, setMasterVolume] = useState(() => {
    const stored_setting = localStorage.getItem(MASTER_VOLUME_KEY);
    const stored_value = stored_setting === null ? Number.NaN : Number(stored_setting);
    return Number.isFinite(stored_value) && stored_value >= 0 && stored_value <= 1 ? stored_value : 0.2;
  });
  const [osu_hit_sound_volume, setOsuHitSoundVolume] = useState(() => {
    const stored_setting = localStorage.getItem(OSU_HIT_SOUND_VOLUME_KEY);
    const stored_value = stored_setting === null ? Number.NaN : Number(stored_setting);
    return Number.isFinite(stored_value) && stored_value >= 0 && stored_value <= 1 ? stored_value : 1;
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
  const [cursor_scale, setCursorScale] = useState(() => {
    const stored_setting = localStorage.getItem(CURSOR_SCALE_KEY);
    const stored_value = stored_setting === null ? Number.NaN : Number(stored_setting);
    return Number.isFinite(stored_value) && stored_value >= 0.25 && stored_value <= 2 ? stored_value : 1;
  });
  const [osu_cursor_renderer, setOsuCursorRenderer] = useState<OsuCursorRendererMode>(() =>
    osuCursorRendererMode(localStorage.getItem(OSU_CURSOR_RENDERER_KEY)));
  const [osu_raw_input, setOsuRawInput] = useState(() => localStorage.getItem(OSU_RAW_INPUT_KEY) !== "false");
  const [osu_slider_renderer, setOsuSliderRenderer] = useState<OsuSliderRendererMode>(() =>
    osuSliderRendererMode(localStorage.getItem(OSU_SLIDER_RENDERER_KEY)));
  const [hit_registration, setHitRegistration] = useState<ManiaHitRegistration>(() =>
    localStorage.getItem(HIT_REGISTRATION_KEY) === "nearest" ? "nearest" : "earliest");
  const [replay_base, setReplayBase] = useState(() => {
    const replay_base = new ManiaReplayBase();
    const stored_setting = localStorage.getItem(MUSIC_RATE_KEY);
    const stored_value = stored_setting === null ? Number.NaN : Number(stored_setting);
    if (Number.isFinite(stored_value) && stored_value >= 0.25 && stored_value <= 4) replay_base.rate = stored_value;
    replay_base.const = localStorage.getItem(CONSTANT_SCROLL_KEY) === "true";
    replay_base.tap_only = localStorage.getItem(TAP_ONLY_KEY) === "true";
    return replay_base;
  });

  useEffect(() => {
    let cancelled = false;
    void loadLocalNoteSkins().then((skins) => {
      if (cancelled) return;
      const options: NoteSkinOption[] = [...note_skin_options];
      for (const skin of skins) {
        const url = URL.createObjectURL(skin.archive);
        local_skin_urls.current.set(skin.id, url);
        options.push(...localNoteSkinOptions(skin, url));
      }
      setAvailableNoteSkins(options);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      for (const url of local_skin_urls.current.values()) URL.revokeObjectURL(url);
      local_skin_urls.current.clear();
    };
  }, []);

  useEffect(() => () => osz_archive_ref.current?.dispose(), []);

  const importOsz = async (file: File) => {
    setScreen("osz-select");
    setOszImporting(true);
    setOszImportError(null);
    if (!file.name.toLowerCase().endsWith(".osz")) {
      setOszImportError("Drop an .osz beatmap archive");
      setOszImporting(false);
      return;
    }
    try {
      const archive = await readOszArchive(file);
      osz_archive_ref.current?.dispose();
      osz_archive_ref.current = archive;
      setOszArchive(archive);
      setScreen("osz-select");
    } catch (reason) {
      console.error(`Failed to import ${file.name}`, reason);
      setOszImportError(reason instanceof Error ? reason.message : "Failed to open the .osz archive");
    } finally {
      setOszImporting(false);
    }
  };

  useEffect(() => {
    if (screen !== "welcome" && screen !== "song-select" && screen !== "osz-select") return;
    const preventDrop = (event: DragEvent) => {
      if ([...event.dataTransfer?.items ?? []].some((item) => item.kind === "file")) event.preventDefault();
    };
    const handleDrop = (event: DragEvent) => {
      const file = [...event.dataTransfer?.files ?? []].find((candidate) => candidate.name.toLowerCase().endsWith(".osz"));
      if (!file) return;
      event.preventDefault();
      void importOsz(file);
    };
    window.addEventListener("dragover", preventDrop);
    window.addEventListener("drop", handleDrop);
    return () => {
      window.removeEventListener("dragover", preventDrop);
      window.removeEventListener("drop", handleDrop);
    };
  }, [screen]);

  const changeMasterVolume = (value: number) => {
    localStorage.setItem(MASTER_VOLUME_KEY, String(value));
    setMasterVolume(value);
  };

  const changeOsuHitSoundVolume = (value: number) => {
    localStorage.setItem(OSU_HIT_SOUND_VOLUME_KEY, String(value));
    setOsuHitSoundVolume(value);
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

  const changeCursorScale = (value: number) => {
    const scale = Math.min(2, Math.max(0.25, Math.round(value * 20) / 20));
    localStorage.setItem(CURSOR_SCALE_KEY, String(scale));
    setCursorScale(scale);
  };

  const changeOsuRawInput = (enabled: boolean) => {
    localStorage.setItem(OSU_RAW_INPUT_KEY, String(enabled));
    setOsuRawInput(enabled);
  };

  const changeOsuCursorRenderer = (renderer: OsuCursorRendererMode) => {
    localStorage.setItem(OSU_CURSOR_RENDERER_KEY, renderer);
    setOsuCursorRenderer(renderer);
  };

  const changeOsuSliderRenderer = (renderer: OsuSliderRendererMode) => {
    localStorage.setItem(OSU_SLIDER_RENDERER_KEY, renderer);
    setOsuSliderRenderer(renderer);
  };

  const changeHitRegistration = (value: ManiaHitRegistration) => {
    localStorage.setItem(HIT_REGISTRATION_KEY, value);
    setHitRegistration(value);
  };

  const changeMusicRate = (value: number) => {
    const rate = Math.round(value * 1000) / 1000;
    localStorage.setItem(MUSIC_RATE_KEY, String(rate));
    setReplayBase((current) => {
      const next = new ManiaReplayBase();
      next.importReplayBase(current.exportReplayBase());
      next.rate = rate;
      return next;
    });
  };

  const changeConstantScroll = (value: boolean) => {
    localStorage.setItem(CONSTANT_SCROLL_KEY, String(value));
    setReplayBase((current) => {
      const next = new ManiaReplayBase();
      next.importReplayBase(current.exportReplayBase());
      next.const = value;
      return next;
    });
  };

  const changeTapOnly = (value: boolean) => {
    localStorage.setItem(TAP_ONLY_KEY, String(value));
    setReplayBase((current) => {
      const next = new ManiaReplayBase();
      next.importReplayBase(current.exportReplayBase());
      next.tap_only = value;
      return next;
    });
  };

  const beginLoading = (chart: Chartview, chart_input_bindings: readonly (string | null)[], song: { title: string; artist: string }, requested_playback: CompletedGameplay | null = null) => {
    const skin_mode = noteSkinMode(chart.mode);
    const note_skin = skin_mode === null ? undefined : selectedNoteSkin(skin_mode, chart.mode === 3 ? chart.keys : null,
      note_skin_selections, available_note_skins);
    setLoadingLocation({
      chart_id: chart.id,
      audio_url: chart.audio_url,
      artist: song.artist,
      background_url: chart.background_url,
      bpm: chart.bpm_avg,
      chart_name: chart.name,
      chart_url: chart.chart_url,
      difficulty: chart.difficulty,
      duration_seconds: chart.duration_seconds,
      long_note_ratio: chart.long_note_ratio,
      note_skin_url: note_skin?.url ?? (chart.mode === 0 ? DEFAULT_OSU_SKIN_URL : null),
      title: song.title,
    });
    setInputBindings(chart_input_bindings);
    setAudioContext(new AudioContext());
    setScore(requested_playback?.score ?? null);
    setCompletedGameplay(requested_playback);
    setPlayback(requested_playback);
    setLoadingReturnScreen(screen === "osz-select" ? "osz-select" : "song-select");
    setScreen("loading");
  };

  const changeNoteSkinSelection = (key: string, skin_id: string | undefined) => {
    setNoteSkinSelections((current) => {
      const next: NoteSkinSelections = { ...current, [key]: skin_id ?? "" };
      saveNoteSkinSelections(next);
      return next;
    });
  };

  const importNoteSkin = async (file: File): Promise<{ options: readonly NoteSkinOption[]; persisted: boolean }> => {
    const skin = await inspectLocalNoteSkin(file);
    const persisted = shouldPersistLocalNoteSkin(file.size);
    if (persisted) await saveLocalNoteSkin(skin);
    const previous_url = local_skin_urls.current.get(skin.id);
    if (previous_url) URL.revokeObjectURL(previous_url);
    const url = URL.createObjectURL(skin.archive);
    local_skin_urls.current.set(skin.id, url);
    const imported_options = localNoteSkinOptions(skin, url, !persisted);
    setAvailableNoteSkins((current) => [
      ...current.filter((option) => option.id !== skin.id),
      ...imported_options,
    ]);
    return { options: imported_options, persisted };
  };

  const cancelLoading = () => {
    if (audio_context) {
      void audio_context.close();
    }

    setAudioContext(null);
    setLoadingLocation(null);
    setScreen(loading_return_screen);
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
    setCompletedGameplay(null);
    setPlayback(null);
    setAudioContext(null);
    setLoadingLocation(null);
    setScreen(loading_return_screen);
  };

  switch (screen) {
    case "welcome":
      return (
        <ScreenTransition key="welcome">
          <WelcomeScreen
            onPlay={() => setScreen("song-select")}
            onUnlockingFps={() => setScreen("unlocking-fps")}
          />
        </ScreenTransition>
      );
    case "unlocking-fps":
      return (
        <ScreenTransition key="unlocking-fps">
          <UnlockingFpsScreen onBack={() => setScreen("welcome")} />
        </ScreenTransition>
      );
    case "gameplay":
      if (!assets) {
        throw new Error("Gameplay assets are not loaded");
      }

      return (
        <ScreenTransition key="gameplay">
          <GameplayScreen
            assets={assets}
            master_volume={master_volume}
            osu_hit_sound_volume={osu_hit_sound_volume}
            music_offset={music_offset}
            scroll_speed={scroll_speed}
            cursor_scale={cursor_scale}
            osu_cursor_renderer={osu_cursor_renderer}
            osu_raw_input={osu_raw_input}
            osu_slider_renderer={osu_slider_renderer}
            replay_base={replay_base}
            input_bindings={input_bindings}
            hit_registration={hit_registration}
            playback={playback ?? undefined}
            onFinish={(completed) => {
              if (playback) {
                setPlayback(null);
                setScreen("result");
                return;
              }
              setCompletedGameplay(completed);
              setScore(completed.score);
              setScreen("result");
              void savePlay(storedPlay(assets.chart_id, completed)).catch((error: unknown) => {
                console.error("Could not save gameplay replay", error);
              });
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
            music_rate={completed_gameplay?.replay_base.rate ?? replay_base.rate}
            difficulty={loading_location?.difficulty ?? 0}
            overall_difficulty={assets?.chart.overall_difficulty ?? 5}
            mode={assets?.mode ?? "mania"}
            onReplay={() => {
              if (!completed_gameplay) return;
              setPlayback(completed_gameplay);
              setScreen("gameplay");
            }}
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
            available_note_skins={available_note_skins}
            onPlay={beginLoading}
            onReplay={(chart, bindings, song, requested_playback) => beginLoading(chart, bindings, song, requested_playback)}
            onSettings={() => setSettingsOpen(true)}
            onMusicRateChange={changeMusicRate}
            onConstantScrollChange={changeConstantScroll}
            onTapOnlyChange={changeTapOnly}
            onNoteSkinSelectionChange={changeNoteSkinSelection}
            onNoteSkinImport={importNoteSkin}
          />
          {settings_open && (
            <SettingsScreen
              master_volume={master_volume}
              osu_hit_sound_volume={osu_hit_sound_volume}
              music_offset={music_offset}
              scroll_speed={scroll_speed}
              scroll_speed_type={scroll_speed_type}
              cursor_scale={cursor_scale}
              osu_cursor_renderer={osu_cursor_renderer}
              osu_raw_input={osu_raw_input}
              osu_slider_renderer={osu_slider_renderer}
              hit_registration={hit_registration}
              onMasterVolumeChange={changeMasterVolume}
              onOsuHitSoundVolumeChange={changeOsuHitSoundVolume}
              onMusicOffsetChange={changeMusicOffset}
              onScrollSpeedChange={changeScrollSpeed}
              onScrollSpeedTypeChange={changeScrollSpeedType}
              onCursorScaleChange={changeCursorScale}
              onOsuCursorRendererChange={changeOsuCursorRenderer}
              onOsuRawInputChange={changeOsuRawInput}
              onOsuSliderRendererChange={changeOsuSliderRenderer}
              onHitRegistrationChange={changeHitRegistration}
              onExit={() => setSettingsOpen(false)}
            />
          )}
        </ScreenTransition>
      );
    case "osz-select":
      return (
        <ScreenTransition key="osz-select">
          <OszSelectScreen archive={osz_archive} importing={osz_importing} import_error={osz_import_error}
            onImport={(file) => void importOsz(file)} onPlay={beginLoading} onBack={() => {
              osz_archive_ref.current?.dispose();
              osz_archive_ref.current = null;
              setOszArchive(null);
              setOszImportError(null);
              setScreen("song-select");
            }} />
        </ScreenTransition>
      );
  }
}
