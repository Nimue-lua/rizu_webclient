import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PropsWithChildren } from "react";
import { flushSync } from "react-dom";
import { HttpGameplayLoader, type GameplayData, type GameplayLocation } from "../library/GameplayLoader";
import { CombinedLibrary } from "../library/Library";
import type { Chartview } from "../library/views";
import { ChartSelector } from "../select/ChartSelector";
import { GameplayScreen } from "./GameplayScreen";
import { LoadingScreen } from "./LoadingScreen";
import { ResultScreen } from "./ResultScreen";
import { SettingsScreen } from "./SettingsScreen";
import { SongSelectScreen } from "./SongSelectScreen";
import { WelcomeScreen } from "./WelcomeScreen";
import { CatalogLoadingScreen } from "./CatalogLoadingScreen";
import type { ScoreResult } from "../gameplay/scoring/ScoreResult";
import { ManiaReplayBase } from "../replay/mania/ManiaReplayBase";
import {
  loadNoteSkinSelections,
  noteSkinMode,
  note_skin_options,
  saveNoteSkinSelections,
  selectedNoteSkin,
  type NoteSkinOption,
  type NoteSkinSelections,
} from "../noteskin/NoteSkinSelection";
import { destroyNoteSkin } from "../noteskin/NoteSkin";
import { NoteSkinCatalog } from "../noteskin/NoteSkinCatalog";
import { deleteNoteSkinOverrides } from "../noteskin/NoteSkinOverrides";
import { deleteScoreDatabase, savePlay, storedPlay } from "../replay/ReplayStore";
import type { CompletedGameplay } from "../replay/RecordedReplay";
import { currentUser, reportPresence, submitPlay, subscribeAccountChanges, type OnlineUser } from "../replay/ReplayServer";
import { appSettings, settings, useSetting } from "../config/Settings";
import { LocalLibraryCatalog, readLocalAsset } from "../library/LocalLibraryStore";
import { RemoteLibraryStore } from "../library/RemoteLibraryStore";
import { SongPreviewPlayer } from "../audio/SongPreviewPlayer";
import type { GameplayBackgroundState } from "../gameplay/GameplaySession";
import { parseChartLink } from "./ChartLink";

type Screen = "welcome" | "catalog-loading" | "song-select" | "loading" | "gameplay" | "result";
type ViewTransitionKind = "screen" | "song-loading" | "loading-gameplay" | "gameplay-result";
type PendingViewTransition = { screen: Screen; kind: ViewTransitionKind; updateState?: () => void };
const gameplay_loader = new HttpGameplayLoader();
const local_library = new LocalLibraryCatalog();
const remote_libraries = new RemoteLibraryStore();
const chart_selector = new ChartSelector(new CombinedLibrary([remote_libraries, local_library]));

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
}

function ScreenContainer({ children }: PropsWithChildren) {
  return <div className="screen-container">{children}</div>;
}

function ChartScreenContainer({ children, background_url, background_class }: PropsWithChildren<{
  background_url: string | null;
  background_class: string;
}>) {
  return (
    <div className="screen-container chart-screen-container">
      {background_url && <img className={`chart-background ${background_class}`} src={background_url} alt="" />}
      <div className="chart-screen-content">{children}</div>
    </div>
  );
}

export function App() {
  const linked_chart = useRef(parseChartLink(window.location.pathname, window.location.hash));
  const [screen, setScreen] = useState<Screen>(() => linked_chart.current ? "catalog-loading" : "welcome");
  const [settings_open, setSettingsOpen] = useState(false);
  const [score_storage_revision, setScoreStorageRevision] = useState(0);
  const [audio_context, setAudioContext] = useState<AudioContext | null>(null);
  const [assets, setAssets] = useState<GameplayData | null>(null);
  const [loading_location, setLoadingLocation] = useState<GameplayLocation | null>(null);
  const [input_bindings, setInputBindings] = useState<readonly (string | null)[]>([]);
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [completed_gameplay, setCompletedGameplay] = useState<CompletedGameplay | null>(null);
  const [playback, setPlayback] = useState<CompletedGameplay | null>(null);
  const [autoplay, setAutoplay] = useState(false);
  const [note_skin_editor, setNoteSkinEditor] = useState(false);
  const [chart_background_url, setChartBackgroundUrl] = useState<string | null>(null);
  const [gameplay_background_state, setGameplayBackgroundState] = useState<GameplayBackgroundState>("visible");
  const [note_skin_selections, setNoteSkinSelections] = useState<NoteSkinSelections>(
    () => ({ osu: "pivnoi_skoof", ...loadNoteSkinSelections() }),
  );
  const [available_note_skins, setAvailableNoteSkins] = useState<readonly NoteSkinOption[]>(note_skin_options);
  const [online_user, setOnlineUser] = useState<OnlineUser | null>(null);
  const [online_count, setOnlineCount] = useState<number | null>(null);
  const [preview_player] = useState(() => new SongPreviewPlayer());
  const active_view_transition = useRef<ViewTransition | null>(null);
  const pending_view_transition = useRef<PendingViewTransition | null>(null);
  const local_library_status = useSyncExternalStore(local_library.subscribe, local_library.getStatus);
  const remote_providers = useSyncExternalStore(remote_libraries.subscribe, remote_libraries.getSnapshot);
  const note_skin_catalog = useRef(new NoteSkinCatalog());
  const master_volume = useSetting(settings.master_volume);
  const osu_hit_sound_volume = useSetting(settings.osu_hit_sound_volume);
  const music_offset = useSetting(settings.music_offset);
  const scroll_speed = useSetting(settings.scroll_speed);
  const cursor_scale = useSetting(settings.cursor_scale);
  const hit_error_meter = useSetting(settings.hit_error_meter);
  const hit_error_meter_type = useSetting(settings.hit_error_meter_type);
  const hit_error_meter_scale = useSetting(settings.hit_error_meter_scale);
  const osu_cursor_renderer = useSetting(settings.osu_cursor_renderer);
  const osu_raw_input = useSetting(settings.osu_raw_input);
  const hit_registration = useSetting(settings.mania_hit_registration);
  const music_rate = useSetting(settings.music_rate);
  const constant_scroll = useSetting(settings.constant_scroll);
  const tap_only = useSetting(settings.tap_only);
  const online_server_address = useSetting(settings.online_server_address);
  const replay_base = useMemo(() => {
    const base = new ManiaReplayBase();
    base.rate = music_rate;
    base.const = constant_scroll;
    base.tap_only = tap_only;
    return base;
  }, [constant_scroll, music_rate, tap_only]);

  useEffect(() => {
    const refresh = () => void currentUser().then(setOnlineUser).catch(() => setOnlineUser(null));
    refresh();
    return subscribeAccountChanges(refresh);
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = () => void reportPresence()
      .then(({ count }) => { if (active) setOnlineCount(count); })
      .catch(() => { if (active) setOnlineCount(null); });
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [online_server_address, online_user?.id]);

  const transitionTo = (next_screen: Screen, kind: ViewTransitionKind = "screen", updateState?: () => void) => {
    const update = () => {
      updateState?.();
      setScreen(next_screen);
    };

    if (!document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      update();
      return;
    }

    const active_transition = active_view_transition.current;
    if (active_transition) {
      pending_view_transition.current = { screen: next_screen, kind, updateState };
      active_transition.skipTransition();
      return;
    }

    document.documentElement.dataset.viewTransition = kind;
    const transition = document.startViewTransition(() => {
      flushSync(update);
    });
    active_view_transition.current = transition;
    void transition.finished.catch(() => undefined).finally(() => {
      if (active_view_transition.current === transition) {
        active_view_transition.current = null;
        delete document.documentElement.dataset.viewTransition;
        const pending = pending_view_transition.current;
        pending_view_transition.current = null;
        if (pending) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => transitionTo(pending.screen, pending.kind, pending.updateState));
          });
        }
      }
    });
  };

  useEffect(() => {
    let cancelled = false;
    void note_skin_catalog.current.load().then((options) => {
      if (!cancelled) setAvailableNoteSkins(options);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      note_skin_catalog.current.dispose();
    };
  }, []);

  useEffect(() => () => {
    preview_player.destroy();
  }, [preview_player]);

  useEffect(() => {
    setChartBackgroundUrl(loading_location?.background_url ?? null);
    if (!loading_location?.source_id || !loading_location.background_path) return;

    let cancelled = false;
    let object_url: string | null = null;
    void readLocalAsset(loading_location.source_id, loading_location.background_path)
      .then((data) => {
        if (cancelled) return;
        object_url = URL.createObjectURL(new Blob([data]));
        setChartBackgroundUrl(object_url);
      })
      .catch((reason: unknown) => console.warn("Failed to load chart background", reason));

    return () => {
      cancelled = true;
      if (object_url) URL.revokeObjectURL(object_url);
    };
  }, [loading_location]);

  const changeMusicRate = (value: number) => {
    const rate = Math.round(value * 1000) / 1000;
    appSettings.set(settings.music_rate, rate);
  };

  const changeConstantScroll = (value: boolean) => {
    appSettings.set(settings.constant_scroll, value);
  };

  const changeTapOnly = (value: boolean) => {
    appSettings.set(settings.tap_only, value);
  };

  const beginLoading = (chart: Chartview, chart_input_bindings: readonly (string | null)[], song: { title: string; artist: string }, requested_playback: CompletedGameplay | null = null, edit_note_skin = false, requested_autoplay = false) => {
    local_library.pause();
    const skin_mode = noteSkinMode(chart.mode);
    const note_skin = skin_mode === null ? undefined : selectedNoteSkin(skin_mode, chart.mode === 3 ? chart.keys : null,
      note_skin_selections, available_note_skins);
    setLoadingLocation({
      chart_id: chart.id,
      chart_md5: chart.chart_md5,
      chart_index: chart.chart_index,
      audio_url: chart.audio_url,
      artist: song.artist,
      background_url: chart.background_url,
      bpm: chart.bpm_avg,
      chart_name: chart.name,
      chart_url: chart.chart_url,
      difficulty: chart.difficulty,
      duration_seconds: chart.duration_seconds,
      keys: chart.keys,
      long_note_ratio: chart.long_note_ratio,
      mode: chart.mode,
      note_skin_url: note_skin?.url ?? null,
      note_skin_id: note_skin?.id ?? "osu-default",
      title: song.title,
      source_id: chart.source_id,
      source_type: chart.source_type,
      audio_path: chart.audio_path,
      background_path: chart.background_path,
      chart_path: chart.chart_path,
    });
    setInputBindings(chart_input_bindings);
    setAudioContext(new AudioContext());
    setScore(requested_playback?.score ?? null);
    setCompletedGameplay(requested_playback);
    setPlayback(requested_playback);
    setAutoplay(requested_autoplay);
    setNoteSkinEditor(edit_note_skin);
    transitionTo("loading", "song-loading");
  };

  const changeNoteSkinSelection = (key: string, skin_id: string | undefined) => {
    setNoteSkinSelections((current) => {
      const next: NoteSkinSelections = { ...current, [key]: skin_id ?? "" };
      saveNoteSkinSelections(next);
      return next;
    });
  };

  const importNoteSkin = async (file: File): Promise<{ options: readonly NoteSkinOption[]; persisted: boolean }> => {
    const result = await note_skin_catalog.current.import(file);
    setAvailableNoteSkins(note_skin_catalog.current.getOptions());
    return result;
  };

  const deleteNoteSkin = async (skin_id: string) => {
    const options = await note_skin_catalog.current.delete(skin_id);
    deleteNoteSkinOverrides(skin_id);
    setAvailableNoteSkins(options);
    setNoteSkinSelections((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([, id]) => id !== skin_id));
      saveNoteSkinSelections(next);
      return next;
    });
  };

  const cancelLoading = () => {
    if (audio_context) {
      void audio_context.close();
    }

    local_library.resume();
    transitionTo("song-select", "screen", () => {
      setAudioContext(null);
      setLoadingLocation(null);
      setNoteSkinEditor(false);
    });
  };

  const finishLoading = (loaded_assets: GameplayData) => {
    preview_player.stop();
    transitionTo("gameplay", "loading-gameplay", () => {
      setAssets(loaded_assets);
      setGameplayBackgroundState("visible");
    });
  };

  const leaveResults = () => {
    if (audio_context) {
      void audio_context.close();
    }

    local_library.resume();
    transitionTo("song-select", "screen", () => {
      if (assets) destroyNoteSkin(assets.note_skin);
      setAssets(null);
      setScore(null);
      setCompletedGameplay(null);
      setPlayback(null);
      setAutoplay(false);
      setNoteSkinEditor(false);
      setAudioContext(null);
      setLoadingLocation(null);
    });
  };

  switch (screen) {
    case "welcome":
      return (
        <ScreenContainer key="welcome">
          <WelcomeScreen
            onPlay={() => {
              transitionTo("catalog-loading");
            }}
          />
        </ScreenContainer>
      );
    case "catalog-loading":
      return (
        <ScreenContainer key="catalog-loading">
          <CatalogLoadingScreen
            chart_selector={chart_selector}
            local_library={local_library}
            onLoaded={() => {
              const identity = linked_chart.current;
              if (identity) chart_selector.selectChartIdentity(identity.chart_md5, identity.chart_index);
              linked_chart.current = null;
              transitionTo("song-select");
            }}
          />
        </ScreenContainer>
      );
    case "gameplay":
      if (!assets) {
        throw new Error("Gameplay assets are not loaded");
      }

      return (
        <ChartScreenContainer background_url={chart_background_url}
          background_class={`gameplay-chart-background ${gameplay_background_state}`}>
          <GameplayScreen
            assets={assets}
            master_volume={master_volume}
            osu_hit_sound_volume={osu_hit_sound_volume}
            music_offset={music_offset}
            scroll_speed={scroll_speed}
            cursor_scale={cursor_scale}
            hit_error_meter={hit_error_meter}
            hit_error_meter_type={hit_error_meter_type}
            hit_error_meter_scale={hit_error_meter_scale}
            osu_cursor_renderer={osu_cursor_renderer}
            osu_raw_input={osu_raw_input}
            replay_base={replay_base}
            input_bindings={input_bindings}
            hit_registration={hit_registration}
            autoplay={autoplay}
            playback={playback ?? undefined}
            note_skin_editor={note_skin_editor}
            initial_lead_in={1.15}
            onBackgroundStateChange={setGameplayBackgroundState}
            onFinish={(completed, reached_chart_end) => {
              if (playback) {
                transitionTo("result", "gameplay-result", () => setPlayback(null));
                return;
              }
              if (autoplay) {
                leaveResults();
                return;
              }
              if (!reached_chart_end) {
                leaveResults();
                return;
              }
              if (note_skin_editor) {
                leaveResults();
                return;
              }
              transitionTo("result", "gameplay-result", () => {
                setCompletedGameplay(completed);
                setScore(completed.score);
              });
              const play = storedPlay(assets.chart_id, completed);
              void savePlay(play).catch((error: unknown) => {
                console.error("Could not save gameplay replay", error);
              });
              void submitPlay(play, assets.chart_md5, assets.chart_index).catch((error: unknown) => {
                console.error("Could not submit gameplay replay", error);
              });
            }}
          />
        </ChartScreenContainer>
      );
    case "loading":
      if (!audio_context || !loading_location) {
        throw new Error("Gameplay loading is not initialized");
      }

      return (
        <ChartScreenContainer background_url={chart_background_url} background_class="loading-chart-background">
          <LoadingScreen
            gameplay_loader={gameplay_loader}
            location={loading_location}
            audio_context={audio_context}
            onCancel={cancelLoading}
            onLoaded={finishLoading}
            background_url={chart_background_url}
          />
        </ChartScreenContainer>
      );
    case "result":
      return (
        <ChartScreenContainer background_url={chart_background_url} background_class="result-chart-background">
          <ResultScreen
            score={score}
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
              transitionTo("gameplay", "gameplay-result", () => setPlayback(completed_gameplay));
            }}
            onExit={() => leaveResults()}
          />
        </ChartScreenContainer>
      );
    case "song-select":
      return (
        <ScreenContainer key="song-select">
          <SongSelectScreen
            chart_selector={chart_selector}
            preview_player={preview_player}
            nickname={online_user?.name ?? "Anonymous"}
            online_count={online_count}
            master_volume={master_volume}
            music_rate={replay_base.rate}
            constant_scroll={replay_base.const}
            tap_only={replay_base.tap_only}
            note_skin_selections={note_skin_selections}
            available_note_skins={available_note_skins}
            score_storage_revision={score_storage_revision}
            local_library_status={local_library_status}
            remote_providers={remote_providers}
            onAddLocalLibrary={async () => {
              const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
              if (!picker) {
                throw new Error("This browser does not support selecting persistent local folders.");
              }
              await local_library.addSource(await picker());
            }}
            onAddRemoteLibrary={(url) => remote_libraries.add(url)}
            onRefreshLibrary={() => {
              const abort_controller = new AbortController();
              void chart_selector.load(abort_controller.signal, true);
            }}
            onPlay={beginLoading}
            onAutoplay={(chart, bindings, song) => beginLoading(chart, bindings, song, null, false, true)}
             onReplay={(chart, bindings, song, requested_playback) => beginLoading(chart, bindings, song, requested_playback)}
             onExit={() => {
               preview_player.stop();
               transitionTo("welcome");
             }}
             onSettings={() => setSettingsOpen(true)}
            onMusicRateChange={changeMusicRate}
            onConstantScrollChange={changeConstantScroll}
            onTapOnlyChange={changeTapOnly}
            onNoteSkinSelectionChange={changeNoteSkinSelection}
            onNoteSkinImport={importNoteSkin}
            onNoteSkinDelete={deleteNoteSkin}
            onNoteSkinEdit={(chart, bindings, song) => beginLoading(chart, bindings, song, null, true, true)}
          />
          {settings_open && (
            <SettingsScreen
              onDeleteScores={async () => {
                await deleteScoreDatabase();
                setScoreStorageRevision((revision) => revision + 1);
              }}
              onExit={() => setSettingsOpen(false)}
            />
          )}
        </ScreenContainer>
      );
  }
}
