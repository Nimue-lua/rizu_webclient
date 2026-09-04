import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import type { GameController } from "../../app/GameController";
import { parseChartLink } from "../../app/ChartLink";
import { useRizuAppController } from "../../app/controller/useRizuAppController";
import { useAppViewTransition, type AppTransition } from "./useAppViewTransition";
import { CatalogLoadingScreen } from "./CatalogLoadingScreen";
import { GameplayScreen } from "./GameplayScreen";
import { LoadingScreen } from "./LoadingScreen";
import { ResultScreen } from "./ResultScreen";
import { SettingsScreen } from "./SettingsScreen";
import { SongSelectScreen } from "./SongSelectScreen";
import { WelcomeScreen } from "./WelcomeScreen";

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

type Screen = "welcome" | "catalog-loading" | "song-select" | "loading" | "gameplay" | "result";

export function DefaultAppView({ game }: { game: GameController }) {
  const controller = useRizuAppController(game);
  const { gameplay, library, modifiers, note_skins, online, results } = controller;
  const linked_chart = useRef(parseChartLink(window.location.pathname, window.location.hash));
  const [screen, setScreen] = useState<Screen>(() => linked_chart.current ? "catalog-loading" : "welcome");
  const [settings_open, setSettingsOpen] = useState(false);
  const transition = useAppViewTransition();
  const navigate = (next: Screen, kind: AppTransition = "screen", update?: () => void) =>
    transition(kind, () => { update?.(); setScreen(next); });

  useEffect(() => {
    if (screen !== "catalog-loading") return;
    let active = true;
    void library.load().then(() => {
      if (!active) return;
      const identity = linked_chart.current;
      if (identity) library.chart_selector.selectChartIdentity(identity.chart_md5, identity.chart_index);
      linked_chart.current = null;
      navigate("song-select");
    }).catch(() => undefined);
    return () => { active = false; library.cancel_loading(); };
  }, [screen, library.load, library.cancel_loading, library.chart_selector]);

  useEffect(() => {
    if (gameplay.status === "ready" && screen === "loading") {
      navigate("gameplay", "loading-gameplay", gameplay.start);
    }
  }, [gameplay.status, screen]);

  switch (screen) {
    case "welcome":
      return <ScreenContainer key="welcome"><WelcomeScreen online_count={online.count} online_players={online.players}
        onPlay={() => navigate("catalog-loading")} /></ScreenContainer>;
    case "catalog-loading":
      return <ScreenContainer key="catalog-loading"><CatalogLoadingScreen progress={library.loading_progress}
        error={library.loading_error} /></ScreenContainer>;
    case "loading":
      if (!gameplay.location) throw new Error("Gameplay loading is not initialized");
      return <ChartScreenContainer background_url={gameplay.background_url} background_class="loading-chart-background">
        <LoadingScreen location={gameplay.location} onCancel={() => navigate("song-select", "screen", gameplay.cancel)}
          background_url={gameplay.background_url}
          progress={gameplay.loading_progress} error={gameplay.loading_error} />
      </ChartScreenContainer>;
    case "gameplay":
      if (!gameplay.assets) throw new Error("Gameplay assets are not loaded");
      return <ChartScreenContainer background_url={gameplay.background_url}
        background_class={`gameplay-chart-background ${gameplay.background_state}`}>
        <GameplayScreen assets={gameplay.assets} configuration={gameplay.configuration}
          input_bindings={gameplay.input_bindings} autoplay={gameplay.autoplay} playback={gameplay.playback ?? undefined}
          note_skin_editor={gameplay.note_skin_editor} initial_lead_in={1.15}
          onBackgroundStateChange={gameplay.set_background_state} onFinish={(completed, reached_chart_end) => {
            const outcome = gameplay.finish(completed, reached_chart_end);
            if (outcome === "result" || outcome === "replay") navigate("result", "gameplay-result");
            else navigate("song-select", "screen", gameplay.discard);
          }} />
      </ChartScreenContainer>;
    case "result": {
      const location = gameplay.location;
      return <ChartScreenContainer background_url={gameplay.background_url} background_class="result-chart-background">
        <ResultScreen score={results.completed?.score ?? null} title={location?.title ?? "Unknown title"}
          artist={location?.artist ?? "Unknown artist"} chart_name={location?.chart_name ?? "Unknown chart"}
          duration_seconds={location?.duration_seconds ?? 0} long_note_ratio={location?.long_note_ratio ?? 0}
          bpm={location?.bpm ?? 0} music_rate={results.completed?.replay_base.rate ?? modifiers.music_rate}
          difficulty={location?.difficulty ?? 0} overall_difficulty={gameplay.assets?.chart.overall_difficulty ?? 5}
          mode={gameplay.assets?.mode ?? "mania"} online_score={online.score} can_comment={online.user !== null}
          onReplay={() => navigate("gameplay", "gameplay-result", gameplay.replay)}
          onExit={() => navigate("song-select", "screen", gameplay.discard)} />
      </ChartScreenContainer>;
    }
    case "song-select":
      return <ScreenContainer key="song-select">
        <SongSelectScreen chart_selector={library.chart_selector} preview_player={controller.preview_player}
          nickname={online.user?.name ?? "Anonymous"} online_count={online.count} master_volume={modifiers.master_volume}
          music_rate={modifiers.music_rate} constant_scroll={modifiers.constant_scroll} tap_only={modifiers.tap_only}
          osu_overall_difficulty={modifiers.osu_overall_difficulty} osu_circle_size={modifiers.osu_circle_size}
          osu_approach_rate={modifiers.osu_approach_rate} note_skin_selections={note_skins.selections}
          available_note_skins={note_skins.options} score_storage_revision={results.score_revision}
          local_library_status={library.local_status} remote_providers={library.remote_providers}
          onAddLocalLibrary={library.add_local} onAddRemoteLibrary={library.add_remote} onRefreshLibrary={library.refresh}
          onPlay={(chart, input_bindings, song) => {
            gameplay.begin({ kind: "play", request: { chart, input_bindings, song } });
            navigate("loading", "song-loading", () => void gameplay.prepare().catch(() => undefined));
          }}
          onAutoplay={(chart, input_bindings, song) => {
            gameplay.begin({ kind: "autoplay", request: { chart, input_bindings, song } });
            navigate("loading", "song-loading", () => void gameplay.prepare().catch(() => undefined));
          }}
          onReplay={(chart, input_bindings, song, playback) => {
            gameplay.begin({ kind: "replay", request: { chart, input_bindings, song }, playback });
            navigate("loading", "song-loading", () => void gameplay.prepare().catch(() => undefined));
          }}
          onNoteSkinEdit={(chart, input_bindings, song) => {
            gameplay.begin({ kind: "note-skin-editor", request: { chart, input_bindings, song } });
            navigate("loading", "song-loading", () => void gameplay.prepare().catch(() => undefined));
          }}
          onExit={() => { controller.preview_player.stop(); navigate("welcome"); }} onSettings={() => setSettingsOpen(true)}
          onMusicRateChange={modifiers.set_music_rate} onConstantScrollChange={modifiers.set_constant_scroll}
          onTapOnlyChange={modifiers.set_tap_only} onOsuOverallDifficultyChange={modifiers.set_osu_overall_difficulty}
          onOsuCircleSizeChange={modifiers.set_osu_circle_size} onOsuApproachRateChange={modifiers.set_osu_approach_rate}
          onNoteSkinSelectionChange={note_skins.select} onNoteSkinImport={note_skins.import}
          onNoteSkinDelete={note_skins.delete} />
        {settings_open && <SettingsScreen onDeleteScores={results.delete_scores} onExit={() => setSettingsOpen(false)} />}
      </ScreenContainer>;
  }
}
