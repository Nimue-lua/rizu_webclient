import "xp.css/dist/XP.css";
import "./windows-xp.css";
import type { GameController } from "../../app/GameController";
import { useRizuAppController } from "../../app/controller/useRizuAppController";
import { OnlinePlayersWindow } from "./OnlinePlayersWindow";
import { WindowsXpWindowContainer } from "./WindowsXpWindowContainer";

export function WindowsXpAppView({ game }: { game: GameController }) {
  const { online } = useRizuAppController(game);

  return (
    <WindowsXpWindowContainer applications={[{
      id: "online-players",
      title: "Online Players",
      defaultOpen: true,
      initialPosition: { x: 96, y: 36 },
      initialSize: { width: 560, height: 400 },
      minSize: { width: 300, height: 220 },
      content: <OnlinePlayersWindow count={online.count} players={online.players} />,
    }]} />
  );
}
