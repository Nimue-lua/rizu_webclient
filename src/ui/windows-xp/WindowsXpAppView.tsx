import "xp.css/dist/XP.css";
import "./windows-xp.css";
import { useEffect, useRef, useState } from "react";
import type { GameController } from "../../app/GameController";
import { useRizuAppController } from "../../app/controller/useRizuAppController";
import { inputLayout, loadInputBindings } from "../../gameplay/InputBindings";
import { GameplayScreen } from "../default/GameplayScreen";
import { ChartBrowserWindow } from "./ChartBrowserWindow";
import { ChartFilterWindow } from "./ChartFilterWindow";
import { ChartScoresWindow } from "./ChartScoresWindow";
import { deleteDesktopBackground, loadDesktopBackground, saveDesktopBackground } from "./DesktopBackgroundStore";
import { DesktopBackgroundWindow } from "./DesktopBackgroundWindow";
import { GameControlsWindow } from "./GameControlsWindow";
import { GameplayModifiersWindow } from "./GameplayModifiersWindow";
import { OnlinePlayersWindow } from "./OnlinePlayersWindow";
import { PlayResultWindow } from "./PlayResultWindow";
import { SettingsWindow } from "./SettingsWindow";
import { WindowsXpGameplayLoading } from "./WindowsXpGameplayLoading";
import { WindowsXpWindowContainer } from "./WindowsXpWindowContainer";

export function WindowsXpAppView({ game }: { game: GameController }) {
  const { gameplay, library, modifiers, online, preview_player, results } = useRizuAppController(game);
  const [background_url, setBackgroundUrl] = useState<string | null>(null);
  const [filter_open_request, setFilterOpenRequest] = useState(0);
  const [modifiers_open_request, setModifiersOpenRequest] = useState(0);
  const [scores_open_request, setScoresOpenRequest] = useState(0);
  const background_url_ref = useRef<string | null>(null);
  const background_revision = useRef(0);
  const background_storage = useRef(Promise.resolve());

  const replaceBackground = (background: Blob | null) => {
    const previous_url = background_url_ref.current;
    const next_url = background ? URL.createObjectURL(background) : null;
    background_url_ref.current = next_url;
    setBackgroundUrl(next_url);
    if (previous_url) URL.revokeObjectURL(previous_url);
  };

  useEffect(() => {
    let active = true;
    const revision = background_revision.current;
    void loadDesktopBackground().then((background) => {
      if (active && revision === background_revision.current && background) replaceBackground(background);
    }).catch(() => undefined);

    return () => {
      active = false;
      if (background_url_ref.current) URL.revokeObjectURL(background_url_ref.current);
      background_url_ref.current = null;
    };
  }, []);

  const changeBackground = (background: File | null) => {
    background_revision.current += 1;
    replaceBackground(background);
    background_storage.current = background_storage.current
      .then(() => background ? saveDesktopBackground(background) : deleteDesktopBackground())
      .catch(() => undefined);
  };

  useEffect(() => {
    if (gameplay.status === "ready") gameplay.start();
    if (gameplay.status === "completed" && !results.completed) gameplay.discard();
  }, [gameplay.status, results.completed]);

  if (gameplay.status === "setup" || gameplay.status === "preparing" || gameplay.status === "ready") {
    return <WindowsXpGameplayLoading gameplay={gameplay} />;
  }

  if (gameplay.status === "running" && gameplay.assets) {
    return (
      <div className="windows-xp-gameplay-container">
        {gameplay.background_url && <img className={`windows-xp-gameplay-background ${gameplay.background_state}`}
          src={gameplay.background_url} alt="" />}
        <GameplayScreen assets={gameplay.assets} configuration={gameplay.configuration}
          input_bindings={gameplay.input_bindings} autoplay={gameplay.autoplay}
          playback={gameplay.playback ?? undefined} initial_lead_in={1.15}
          onBackgroundStateChange={gameplay.set_background_state} onFinish={(completed, reached_chart_end) => {
            gameplay.finish(completed, reached_chart_end);
          }} />
      </div>
    );
  }

  return (
    <WindowsXpWindowContainer backgroundUrl={background_url} applications={[
      {
        id: "chart-browser",
        title: "Music Library",
        iconUrl: "/dmca_incoming/music_folder.png",
        defaultOpen: true,
        initialPosition: { x: 112, y: 28 },
        initialSize: { width: 900, height: 620 },
        minSize: { width: 560, height: 360 },
        content: <ChartBrowserWindow library={library} previewPlayer={preview_player}
          masterVolume={modifiers.master_volume} onOpenFilter={() => setFilterOpenRequest((request) => request + 1)}
          onOpenModifiers={() => setModifiersOpenRequest((request) => request + 1)}
          onOpenScores={() => setScoresOpenRequest((request) => request + 1)}
          onPlay={(chart, song) => {
          gameplay.begin({
            kind: "play",
            request: { chart, song: { title: song.title, artist: song.artist }, input_bindings: loadInputBindings(inputLayout(chart)) },
          });
          void gameplay.prepare().catch(() => undefined);
        }} />,
      },
      {
        id: "chart-scores",
        title: "Chart Scores",
        desktopIcon: false,
        initialPosition: { x: 260, y: 110 },
        initialSize: { width: 720, height: 390 },
        minSize: { width: 520, height: 280 },
        openRequest: scores_open_request,
        content: <ChartScoresWindow selector={library.chart_selector} gameplay={gameplay}
          nickname={online.user?.name ?? "Anonymous"} scoreRevision={results.score_revision} />,
      },
      {
        id: "chart-filter",
        title: "Chart Filter",
        desktopIcon: false,
        initialPosition: { x: 310, y: 130 },
        initialSize: { width: 360, height: 250 },
        minSize: { width: 300, height: 220 },
        resizable: false,
        openRequest: filter_open_request,
        content: <ChartFilterWindow selector={library.chart_selector} />,
      },
      {
        id: "gameplay-modifiers",
        title: "Gameplay Modifiers",
        desktopIcon: false,
        initialPosition: { x: 350, y: 80 },
        initialSize: { width: 420, height: 500 },
        minSize: { width: 340, height: 300 },
        openRequest: modifiers_open_request,
        content: <GameplayModifiersWindow selector={library.chart_selector} modifiers={modifiers} />,
      },
      {
        id: "online-players",
        title: "Online Players",
        iconUrl: "/dmca_incoming/people.avif",
        initialPosition: { x: 72, y: 52 },
        initialSize: { width: 560, height: 400 },
        minSize: { width: 300, height: 220 },
        content: <OnlinePlayersWindow count={online.count} players={online.players} />,
      },
      {
        id: "game-controls",
        title: "Game Controls",
        iconUrl: "/dmca_incoming/game_controller.avif",
        initialPosition: { x: 190, y: 42 },
        initialSize: { width: 600, height: 550 },
        minSize: { width: 430, height: 390 },
        content: <GameControlsWindow />,
      },
      {
        id: "settings",
        title: "Settings",
        iconUrl: "/dmca_incoming/system_properties.avif",
        initialPosition: { x: 230, y: 66 },
        initialSize: { width: 510, height: 440 },
        minSize: { width: 400, height: 360 },
        resizable: false,
        content: <SettingsWindow />,
      },
      {
        id: "desktop-background",
        title: "Desktop Background",
        iconUrl: "/dmca_incoming/display.avif",
        initialPosition: { x: 150, y: 80 },
        initialSize: { width: 420, height: 390 },
        minSize: { width: 330, height: 320 },
        resizable: false,
        content: <DesktopBackgroundWindow backgroundUrl={background_url} onBackgroundChange={changeBackground} />,
      },
      ...(gameplay.status === "completed" && gameplay.location && gameplay.assets && results.completed ? [{
        id: "play-result",
        title: "Play Result",
        desktopIcon: false,
        defaultOpen: true,
        initialPosition: { x: 180, y: 44 },
        initialSize: { width: 680, height: 570 },
        minSize: { width: 480, height: 420 },
        content: <PlayResultWindow completed={results.completed} location={gameplay.location}
          overallDifficulty={gameplay.assets.chart.overall_difficulty ?? 5}
          approachRate={gameplay.assets.mode === "osu" ? gameplay.assets.chart.approach_rate : null}
          onReplay={gameplay.replay} />,
        onClose: gameplay.discard,
      }] : []),
    ]} />
  );
}
