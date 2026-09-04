import "xp.css/dist/XP.css";
import "./windows-xp.css";
import { useState } from "react";
import type { GameController } from "../../app/GameController";
import { useRizuAppController } from "../../app/controller/useRizuAppController";
import { ChartBrowserWindow } from "./ChartBrowserWindow";
import { DesktopBackgroundWindow } from "./DesktopBackgroundWindow";
import { OnlinePlayersWindow } from "./OnlinePlayersWindow";
import { WindowsXpWindowContainer } from "./WindowsXpWindowContainer";

export function WindowsXpAppView({ game }: { game: GameController }) {
  const { library, online, preview_player } = useRizuAppController(game);
  const [background_url, setBackgroundUrl] = useState<string | null>(null);

  return (
    <WindowsXpWindowContainer backgroundUrl={background_url} applications={[
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
