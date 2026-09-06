import { GameplaySettingsController } from "../config/GameplaySettingsController";
import type { GameplayBackgroundState } from "../gameplay/GameplaySession";
import type { GameplayFinishOutcome, GameplayLaunch } from "../gameplay/GameplayController";
import type { GameplayLoadProgress, GameplayLocation } from "../library/GameplayLoader";
import type { LibraryLoadProgress } from "../library/LibraryController";
import { readLocalAsset } from "../library/LocalLibraryStore";
import type { Chartview } from "../library/views";
import { destroyNoteSkin } from "../noteskin/NoteSkin";
import { deleteNoteSkinOverrides } from "../noteskin/NoteSkinOverrides";
import { compatibleNoteSkins, loadNoteSkinSelections, noteSkinMode, note_skin_options, saveNoteSkinSelections, selectedNoteSkin,
  type NoteSkinOption, type NoteSkinSelections } from "../noteskin/NoteSkinSelection";
import type { CompletedGameplay } from "../replay/RecordedReplay";
import { danAccuracy, type ResolvedDanCourse } from "../dan/DanCourse";
import type { GameplayData } from "../library/GameplayLoader";
import { deleteScoreDatabase, savePlay, storedPlay } from "../replay/ReplayStore";
import { currentUser, reportPresence, submitPlay, subscribeAccountChanges } from "../replay/ReplayServer";
import type { AppServices } from "./controller/AppServices";
import type { GameState } from "./GameState";

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
}

type Listener = () => void;

function gameplayLocation(chart: Chartview, song: { title: string; artist: string },
  selections: NoteSkinSelections, options: readonly NoteSkinOption[]): GameplayLocation {
  const skin_mode = noteSkinMode(chart.mode);
  const note_skin = skin_mode === null ? undefined : selectedNoteSkin(skin_mode, chart.mode === 3 ? chart.keys : null,
    selections, options);
  return {
    chart_id: chart.id, chart_md5: chart.chart_md5, chart_index: chart.chart_index, audio_url: chart.audio_url,
    artist: song.artist, background_url: chart.background_url, bpm: chart.bpm_avg, chart_name: chart.name,
    chart_url: chart.chart_url, difficulty: chart.difficulty, duration_seconds: chart.duration_seconds,
    keys: chart.keys, long_note_ratio: chart.long_note_ratio, mode: chart.mode, note_skin_url: note_skin?.url ?? null,
    note_skin_id: note_skin?.id ?? "osu-default", title: song.title, source_id: chart.source_id,
    source_type: chart.source_type, audio_path: chart.audio_path, background_path: chart.background_path,
    chart_path: chart.chart_path,
  };
}

export class GameController {
  private readonly listeners = new Set<Listener>();
  private readonly settings = new GameplaySettingsController();
  private state: GameState;
  private catalog_load: AbortController | null = null;
  private gameplay_load: AbortController | null = null;
  private audio_load: AbortController | null = null;
  private gameplay_preparation: Promise<void> | null = null;
  private audio_preparation: Promise<AudioBuffer> | null = null;
  private prepared_audio: AudioBuffer | null = null;
  private background_revision = 0;
  private background_object_url: string | null = null;
  private score_attempt = 0;
  private loaded = false;
  private unsubscribe_account: (() => void) | null = null;
  private presence_timer: number | null = null;
  private dan_assets: (GameplayData | null)[] = [];

  constructor(private readonly services: AppServices) {
    this.state = this.createState();
    services.local_library.subscribe(() => this.update({ library: { ...this.state.library,
      local_status: services.local_library.getStatus() } }));
    services.remote_libraries.subscribe(() => this.update({ library: { ...this.state.library,
      remote_providers: services.remote_libraries.getSnapshot() } }));
    this.settings.subscribe(() => {
      const settings = this.settings.getSnapshot();
      this.update({ modifiers: settings.modifiers, gameplay: { ...this.state.gameplay,
        configuration: settings.configuration } });
      this.refreshOnline();
    });
  }

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): GameState => this.state;

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    void this.services.note_skin_catalog.load().then((options) => {
      if (this.loaded) this.update({ note_skins: { ...this.state.note_skins, options } });
    }).catch(() => undefined);
    const refresh_account = () => void currentUser().then((user) => {
      if (!this.loaded) return;
      this.update({ online: { ...this.state.online, user } });
      this.refreshOnline();
    }).catch(() => {
      if (this.loaded) this.update({ online: { ...this.state.online, user: null } });
    });
    refresh_account();
    this.unsubscribe_account = subscribeAccountChanges(refresh_account);
    this.refreshOnline();
    this.presence_timer = window.setInterval(() => this.refreshOnline(), 30_000);
  }

  unload(): void {
    if (!this.loaded) return;
    this.loaded = false;
    this.catalog_load?.abort();
    this.gameplay_load?.abort();
    this.audio_load?.abort();
    this.discardDan();
    this.unsubscribe_account?.();
    this.unsubscribe_account = null;
    if (this.presence_timer !== null) window.clearInterval(this.presence_timer);
    this.presence_timer = null;
  }

  private createState(): GameState {
    const settings = this.settings.getSnapshot();
    const library = {
      chart_selector: this.services.chart_selector,
      local_status: this.services.local_library.getStatus(),
      remote_providers: this.services.remote_libraries.getSnapshot(),
      loading_progress: new Map<string, LibraryLoadProgress>(), loading_error: null,
      load: () => this.loadLibrary(), cancel_loading: () => this.catalog_load?.abort(),
      add_local: async () => {
        const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
        if (!picker) throw new Error("This browser does not support selecting persistent local folders.");
        await this.services.local_library.addSource(await picker());
      },
      add_remote: (url: string) => this.services.remote_libraries.add(url),
      refresh: () => { const abort = new AbortController(); void this.services.chart_selector.load(abort.signal, true); },
    };
    const gameplay = {
      status: "idle" as const, location: null, audio_context: null, assets: null, configuration: settings.configuration,
      input_bindings: [] as readonly (string | null)[], playback: null, autoplay: false, note_skin_editor: false,
      restart_revision: 0,
      background_url: null, background_state: "visible" as GameplayBackgroundState,
      loading_progress: new Map<string, GameplayLoadProgress>(), loading_error: null,
      begin: (request: GameplayLaunch) => this.beginGameplay(request), prepare: () => this.prepareGameplay(),
      preload_audio: () => this.preloadGameplayAudio(),
      set_input_bindings: (input_bindings: readonly (string | null)[]) => {
        if (this.state.gameplay.status !== "setup") throw new Error("Gameplay setup is not active");
        this.update({ gameplay: { ...this.state.gameplay, input_bindings } });
      },
      select_note_skin: (skin_id: string) => this.selectGameplayNoteSkin(skin_id),
      start: () => this.startGameplay(), cancel: () => this.cancelGameplay(),
      finish: (completed: CompletedGameplay, reached_chart_end: boolean) => this.finishGameplay(completed, reached_chart_end),
      replay: () => this.replayGameplay(), restart: () => this.restartGameplay(), discard: () => this.discardGameplay(),
      set_background_state: (background_state: GameplayBackgroundState) =>
        this.update({ gameplay: { ...this.state.gameplay, background_state } }),
    };
    const selections = { osu: "pivnoi_skoof", ...loadNoteSkinSelections() };
    const note_skins = {
      selections, options: note_skin_options,
      select: (key: string, skin_id: string | undefined) => {
        const next = { ...this.state.note_skins.selections, [key]: skin_id ?? "" };
        saveNoteSkinSelections(next);
        this.update({ note_skins: { ...this.state.note_skins, selections: next } });
      },
      import: async (file: File) => {
        const result = await this.services.note_skin_catalog.import(file);
        this.update({ note_skins: { ...this.state.note_skins, options: this.services.note_skin_catalog.getOptions() } });
        return result;
      },
      delete: async (skin_id: string) => {
        const options = await this.services.note_skin_catalog.delete(skin_id);
        deleteNoteSkinOverrides(skin_id);
        const next = Object.fromEntries(Object.entries(this.state.note_skins.selections).filter(([, id]) => id !== skin_id));
        saveNoteSkinSelections(next);
        this.update({ note_skins: { ...this.state.note_skins, options, selections: next } });
      },
    };
    const dan = {
      status: "idle" as const, course: null, stage_index: 0, completed_stages: [], result: null,
      begin: (course: ResolvedDanCourse) => this.beginDan(course),
      continue: () => this.continueDan(),
      discard: () => this.discardDan(),
    };
    return {
      library, gameplay, modifiers: settings.modifiers, note_skins, dan,
      online: { user: null, count: null, players: [], score: null },
      results: { completed: null, score_revision: 0, delete_scores: async () => {
        await deleteScoreDatabase();
        this.update({ results: { ...this.state.results, score_revision: this.state.results.score_revision + 1 } });
      } },
      preview_player: this.services.preview_player,
    };
  }

  private update(change: Partial<GameState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }

  private async loadLibrary(): Promise<void> {
    this.catalog_load?.abort();
    const abort = new AbortController();
    this.catalog_load = abort;
    this.update({ library: { ...this.state.library, loading_progress: new Map(), loading_error: null } });
    try {
      await this.services.local_library.reconnectSources();
      await this.services.chart_selector.load(abort.signal, false, (item) => {
        const loading_progress = new Map(this.state.library.loading_progress).set(item.id, item);
        this.update({ library: { ...this.state.library, loading_progress } });
      });
      const error = this.services.chart_selector.getSnapshot().error;
      if (error) throw new Error(error);
    } catch (reason) {
      if (abort.signal.aborted) throw reason;
      this.update({ library: { ...this.state.library,
        loading_error: reason instanceof Error ? reason.message : "Failed to load song catalogs" } });
      throw reason;
    }
  }

  private beginGameplay(launch: GameplayLaunch): void {
    if (this.state.dan.status !== "idle") this.discardDan();
    this.cancelGameplay();
    this.services.local_library.pause();
    this.prepared_audio = null;
    this.audio_preparation = null;
    const playback = launch.kind === "replay" ? launch.playback : null;
    const location = gameplayLocation(launch.request.chart, launch.request.song, this.state.note_skins.selections,
      this.state.note_skins.options);
    this.update({
      gameplay: { ...this.state.gameplay, status: "setup", location, audio_context: new AudioContext(), assets: null,
        input_bindings: launch.request.input_bindings, playback,
        autoplay: launch.kind === "autoplay" || launch.kind === "note-skin-editor",
        note_skin_editor: launch.kind === "note-skin-editor", restart_revision: 0,
        loading_progress: new Map(), loading_error: null },
      results: { ...this.state.results, completed: playback },
      online: { ...this.state.online, score: null },
    });
    this.updateBackground(location);
  }

  private preloadGameplayAudio(): Promise<void> {
    if (this.prepared_audio) return Promise.resolve();
    if (this.audio_preparation) return this.audio_preparation.then(() => undefined);
    const { location, audio_context } = this.state.gameplay;
    if (!location || !audio_context || this.state.gameplay.status !== "setup") {
      return Promise.reject(new Error("Gameplay setup has not been started"));
    }
    const abort = new AbortController();
    this.audio_load = abort;
    const preparation = this.services.gameplay_loader.loadAudio(location, audio_context, abort.signal, (progress) => {
      const loading_progress = new Map(this.state.gameplay.loading_progress)
        .set("audio", { ...progress, id: "audio", label: "Music" } as GameplayLoadProgress);
      this.update({ gameplay: { ...this.state.gameplay, loading_progress } });
    }).then((audio) => {
      if (abort.signal.aborted) throw new DOMException("Audio preparation was cancelled", "AbortError");
      this.prepared_audio = audio;
      return audio;
    }).finally(() => {
      if (this.audio_preparation === preparation) this.audio_preparation = null;
    });
    this.audio_preparation = preparation;
    return preparation.then(() => undefined);
  }

  private selectGameplayNoteSkin(skin_id: string): void {
    const gameplay = this.state.gameplay;
    if (gameplay.status !== "setup" || !gameplay.location) throw new Error("Gameplay setup is not active");
    const option = compatibleNoteSkins(noteSkinMode(gameplay.location.mode), gameplay.location.keys,
      this.state.note_skins.options).find((candidate) => candidate.id === skin_id);
    if (!option) throw new Error("The selected note skin is not available");
    this.update({ gameplay: { ...gameplay, location: { ...gameplay.location, note_skin_id: option.id,
      note_skin_url: option.url } } });
  }

  private prepareGameplay(): Promise<void> {
    if (this.state.gameplay.status === "ready" || this.state.gameplay.status === "running") return Promise.resolve();
    if (this.gameplay_preparation) return this.gameplay_preparation;
    const { location, audio_context } = this.state.gameplay;
    if (!location || !audio_context || this.state.gameplay.status !== "setup") {
      return Promise.reject(new Error("Gameplay preparation has not been started"));
    }
    const abort = new AbortController();
    this.gameplay_load = abort;
    this.update({ gameplay: { ...this.state.gameplay, status: "preparing", loading_progress: new Map(), loading_error: null } });
    const audio = this.audio_preparation ?? Promise.resolve(this.prepared_audio);
    const preparation = audio.then((prepared_audio) => this.services.gameplay_loader.load(
      location, audio_context, abort.signal, (item) => {
      const loading_progress = new Map(this.state.gameplay.loading_progress).set(item.id, item);
      this.update({ gameplay: { ...this.state.gameplay, loading_progress } });
    }, prepared_audio ?? undefined)).then((assets) => {
      if (abort.signal.aborted) throw new DOMException("Gameplay preparation was cancelled", "AbortError");
      this.services.preview_player.stop();
      this.update({ gameplay: { ...this.state.gameplay, status: "ready", assets } });
    }).catch((reason: unknown) => {
      if (!abort.signal.aborted) this.update({ gameplay: { ...this.state.gameplay, status: "setup",
        loading_error: reason instanceof Error ? reason.message : "Failed to prepare gameplay" } });
      throw reason;
    }).finally(() => {
      if (this.gameplay_preparation === preparation) this.gameplay_preparation = null;
    });
    this.gameplay_preparation = preparation;
    return preparation;
  }

  private startGameplay(): void {
    if (this.state.gameplay.status !== "ready" || !this.state.gameplay.assets) {
      throw new Error("Gameplay is not ready");
    }
    this.update({ gameplay: { ...this.state.gameplay, status: "running", background_state: "visible" } });
  }

  private cancelGameplay(): void {
    this.gameplay_load?.abort();
    this.audio_load?.abort();
    this.gameplay_preparation = null;
    this.audio_preparation = null;
    this.prepared_audio = null;
    if (this.state.gameplay.status === "idle") return;
    this.releaseGameplay();
  }

  private discardGameplay(): void {
    this.score_attempt += 1;
    this.releaseGameplay();
  }

  private releaseGameplay(): void {
    const { audio_context, assets } = this.state.gameplay;
    if (audio_context) void audio_context.close();
    if (assets) destroyNoteSkin(assets.note_skin);
    this.services.local_library.resume();
    this.update({
      gameplay: { ...this.state.gameplay, status: "idle", location: null, audio_context: null, assets: null,
        playback: null, autoplay: false, note_skin_editor: false, restart_revision: 0 },
      results: { ...this.state.results, completed: null },
      online: { ...this.state.online, score: null },
    });
  }

  private finishGameplay(completed: CompletedGameplay, reached_chart_end: boolean): GameplayFinishOutcome {
    const gameplay = this.state.gameplay;
    if (gameplay.status !== "running") throw new Error("Gameplay is not running");
    if (gameplay.playback) {
      this.update({ gameplay: { ...gameplay, status: "completed", playback: null } });
      return "replay";
    }
    if (gameplay.autoplay || !reached_chart_end || gameplay.note_skin_editor || !gameplay.assets) {
      this.update({ gameplay: { ...gameplay, status: "completed" } });
      return "discarded";
    }
    if (this.state.dan.status === "playing") return this.finishDanStage(completed);
    const attempt = ++this.score_attempt;
    this.update({
      gameplay: { ...gameplay, status: "completed" }, results: { ...this.state.results, completed },
      online: { ...this.state.online, score: { id: null, state: "pending" } },
    });
    const play = storedPlay(gameplay.assets.chart_id, completed);
    void savePlay(play).catch((error: unknown) => console.error("Could not save gameplay replay", error));
    void submitPlay(play, gameplay.assets.chart_md5, gameplay.assets.chart_index).then((id) => {
      if (this.score_attempt === attempt) this.update({ online: { ...this.state.online, score: { id, state: "ready" } } });
    }).catch((error: unknown) => {
      console.error("Could not submit gameplay replay", error);
      if (this.score_attempt === attempt) this.update({ online: { ...this.state.online,
        score: { id: null, state: "error" } } });
    });
    return "result";
  }

  private async beginDan(course: ResolvedDanCourse): Promise<void> {
    this.discardDan();
    this.cancelGameplay();
    this.services.local_library.pause();
    this.update({ dan: { ...this.state.dan, status: "preparing", course, stage_index: 0,
      completed_stages: [], result: null } });
    const abort = new AbortController();
    this.gameplay_load = abort;
    const prepared: GameplayData[] = [];
    try {
      for (const request of course.stages) {
        const location = gameplayLocation(request.chart, request.song, this.state.note_skins.selections,
          this.state.note_skins.options);
        const audio_context = new AudioContext();
        try {
          prepared.push(await this.services.gameplay_loader.load(location, audio_context, abort.signal));
        } catch (reason) {
          void audio_context.close();
          throw reason;
        }
      }
      if (abort.signal.aborted) throw new DOMException("Dan preparation was cancelled", "AbortError");
      this.dan_assets = prepared;
      this.activateDanStage(0);
    } catch (reason) {
      for (const assets of prepared) {
        void assets.audio_context.close();
        destroyNoteSkin(assets.note_skin);
      }
      if (!abort.signal.aborted) {
        this.update({ dan: { ...this.state.dan, status: "idle", course: null },
          gameplay: { ...this.state.gameplay, loading_error: reason instanceof Error ? reason.message : "Failed to prepare dan course" } });
      }
      this.services.local_library.resume();
      throw reason;
    }
  }

  private activateDanStage(stage_index: number): void {
    const course = this.state.dan.course;
    const request = course?.stages[stage_index];
    const assets = this.dan_assets[stage_index];
    if (!course || !request || !assets) throw new Error("Dan stage is not prepared");
    const location = gameplayLocation(request.chart, request.song, this.state.note_skins.selections,
      this.state.note_skins.options);
    this.update({
      dan: { ...this.state.dan, status: "playing", stage_index },
      gameplay: { ...this.state.gameplay, status: "ready", location, audio_context: assets.audio_context, assets,
        input_bindings: request.input_bindings, playback: null, autoplay: false, note_skin_editor: false,
        restart_revision: 0, loading_progress: new Map(), loading_error: null },
      results: { ...this.state.results, completed: null },
      online: { ...this.state.online, score: null },
    });
    this.updateBackground(location);
  }

  private finishDanStage(completed: CompletedGameplay): GameplayFinishOutcome {
    const completed_stages = [...this.state.dan.completed_stages, completed];
    const final = completed_stages.length === this.state.dan.course?.stages.length;
    const accuracy = danAccuracy(completed_stages.map((stage) => stage.score), this.state.dan.course?.mode);
    this.update({
      gameplay: { ...this.state.gameplay, status: "completed" },
      results: { ...this.state.results, completed },
      dan: final && this.state.dan.course
        ? { ...this.state.dan, status: "completed", completed_stages,
          result: { course: this.state.dan.course, stages: completed_stages, accuracy,
            cleared: accuracy >= this.state.dan.course.goal_accuracy } }
        : { ...this.state.dan, status: "break", completed_stages },
    });
    return final ? "dan-result" : "dan-break";
  }

  private continueDan(): void {
    if (this.state.dan.status !== "break") throw new Error("Dan course is not at a break");
    this.releaseDanStage(this.state.dan.stage_index);
    this.activateDanStage(this.state.dan.stage_index + 1);
  }

  private releaseDanStage(index: number): void {
    const assets = this.dan_assets[index];
    if (!assets) return;
    void assets.audio_context.close();
    destroyNoteSkin(assets.note_skin);
    this.dan_assets[index] = null;
  }

  private discardDan(): void {
    if (this.state.dan?.status === "idle") return;
    this.gameplay_load?.abort();
    for (let index = 0; index < this.dan_assets.length; index += 1) this.releaseDanStage(index);
    this.dan_assets = [];
    this.services.local_library.resume();
    if (this.state.dan) this.update({
      dan: { ...this.state.dan, status: "idle", course: null, stage_index: 0, completed_stages: [], result: null },
      gameplay: { ...this.state.gameplay, status: "idle", location: null, audio_context: null, assets: null,
        playback: null, autoplay: false, note_skin_editor: false, restart_revision: 0 },
      results: { ...this.state.results, completed: null },
    });
  }

  private replayGameplay(): void {
    const completed = this.state.results.completed;
    if (!completed || !this.state.gameplay.assets) throw new Error("There is no completed gameplay to replay");
    this.update({ gameplay: { ...this.state.gameplay, status: "running", playback: completed } });
  }

  private restartGameplay(): void {
    if (this.state.dan.status !== "idle") throw new Error("Restarting the chart is not allowed during a dan course");
    if (this.state.gameplay.status !== "running") throw new Error("Gameplay is not running");
    this.update({ gameplay: { ...this.state.gameplay, restart_revision: this.state.gameplay.restart_revision + 1 } });
  }

  private updateBackground(location: GameplayLocation): void {
    const revision = ++this.background_revision;
    if (this.background_object_url) URL.revokeObjectURL(this.background_object_url);
    this.background_object_url = null;
    this.update({ gameplay: { ...this.state.gameplay, background_url: location.background_url } });
    if (!location.source_id || !location.background_path) return;
    void readLocalAsset(location.source_id, location.background_path).then((data) => {
      if (revision !== this.background_revision) return;
      this.background_object_url = URL.createObjectURL(new Blob([data]));
      this.update({ gameplay: { ...this.state.gameplay, background_url: this.background_object_url } });
    }).catch((reason: unknown) => console.warn("Failed to load chart background", reason));
  }

  private refreshOnline(): void {
    if (!this.loaded) return;
    const active_user = this.state.online.user;
    void reportPresence().then((presence) => {
      if (this.loaded && this.state.online.user === active_user) this.update({ online: { ...this.state.online,
        count: presence.count, players: presence.players } });
    }).catch(() => {
      if (this.loaded && this.state.online.user === active_user) {
        this.update({ online: { ...this.state.online, count: null, players: [] } });
      }
    });
  }
}
