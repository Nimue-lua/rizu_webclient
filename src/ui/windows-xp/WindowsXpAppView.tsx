import "xp.css/dist/XP.css";
import "./windows-xp.css";
import type { GameController } from "../../app/GameController";
import { useRizuAppController } from "../../app/controller/useRizuAppController";
import { ChartBrowserWindow } from "./ChartBrowserWindow";
import { OnlinePlayersWindow } from "./OnlinePlayersWindow";
import { WindowsXpWindowContainer } from "./WindowsXpWindowContainer";

export function WindowsXpAppView({ game }: { game: GameController }) {
  const { library, online, preview_player } = useRizuAppController(game);

  return (
    <WindowsXpWindowContainer applications={[
      {
        id: "chart-browser",
        title: "Rizu Music Library",
        defaultOpen: true,
        initialPosition: { x: 112, y: 28 },
        initialSize: { width: 900, height: 620 },
        minSize: { width: 560, height: 360 },
        content: <ChartBrowserWindow library={library} previewPlayer={preview_player} />,
      },
      {
        id: "online-players",
        title: "Online Players",
        initialPosition: { x: 72, y: 52 },
        initialSize: { width: 560, height: 400 },
        minSize: { width: 300, height: 220 },
        content: <OnlinePlayersWindow count={online.count} players={online.players} />,
      },
    ]} />
  );
}
