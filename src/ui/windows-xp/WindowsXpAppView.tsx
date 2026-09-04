import "xp.css/dist/XP.css";
import "./windows-xp.css";
import { useEffect, useState } from "react";
import type { GameController } from "../../app/GameController";
import { useRizuAppController } from "../../app/controller/useRizuAppController";
import { inputLayout, loadInputBindings } from "../../gameplay/InputBindings";
import { GameplayScreen } from "../default/GameplayScreen";
import { ChartBrowserWindow } from "./ChartBrowserWindow";
import { DesktopBackgroundWindow } from "./DesktopBackgroundWindow";
import { OnlinePlayersWindow } from "./OnlinePlayersWindow";
import { WindowsXpGameplayLoading } from "./WindowsXpGameplayLoading";
import { WindowsXpWindowContainer } from "./WindowsXpWindowContainer";

export function WindowsXpAppView({ game }: { game: GameController }) {
  const { gameplay, library, modifiers, online, preview_player } = useRizuAppController(game);
  const [background_url, setBackgroundUrl] = useState<string | null>(null);

  useEffect(() => {
    if (gameplay.status === "ready") gameplay.start();
    if (gameplay.status === "completed") gameplay.discard();
  }, [gameplay.status]);

  if (gameplay.status === "setup" || gameplay.status === "preparing" || gameplay.status === "ready") {
    return <WindowsXpGameplayLoading gameplay={gameplay} />;
  }

  if (gameplay.status === "running" && gameplay.assets) {
    return (
      <div className="windows-xp-gameplay-container">
        {gameplay.background_url && <img className={`windows-xp-gameplay-background ${gameplay.background_state}`}
          src={gameplay.background_url} alt="" />}
        <GameplayScreen assets={gameplay.assets} configuration={gameplay.configuration}
          input_bindings={gameplay.input_bindings} initial_lead_in={1.15}
          onBackgroundStateChange={gameplay.set_background_state} onFinish={(completed, reached_chart_end) => {
            gameplay.finish(completed, reached_chart_end);
            gameplay.discard();
          }} />
      </div>
    );
  }

  return (
    <WindowsXpWindowContainer backgroundUrl={background_url} applications={[
      {
        id: "chart-browser",
        title: "Rizu Music Library",
        defaultOpen: true,
        initialPosition: { x: 112, y: 28 },
        initialSize: { width: 900, height: 620 },
        minSize: { width: 560, height: 360 },
        content: <ChartBrowserWindow library={library} previewPlayer={preview_player}
          masterVolume={modifiers.master_volume} onPlay={(chart, song) => {
          gameplay.begin({
            kind: "play",
            request: { chart, song: { title: song.title, artist: song.artist }, input_bindings: loadInputBindings(inputLayout(chart)) },
          });
          void gameplay.prepare().catch(() => undefined);
        }} />,
      },
      {
        id: "online-players",
        title: "Online Players",
        initialPosition: { x: 72, y: 52 },
        initialSize: { width: 560, height: 400 },
        minSize: { width: 300, height: 220 },
        content: <OnlinePlayersWindow count={online.count} players={online.players} />,
      },
      {
        id: "desktop-background",
        title: "Desktop Background",
        initialPosition: { x: 150, y: 80 },
        initialSize: { width: 420, height: 390 },
        minSize: { width: 330, height: 320 },
        resizable: false,
        content: <DesktopBackgroundWindow backgroundUrl={background_url} onBackgroundChange={setBackgroundUrl} />,
      },
    ]} />
  );
}
