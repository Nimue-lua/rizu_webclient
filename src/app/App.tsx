import type { ComponentType } from "react";
import { createAppServices } from "./controller/AppServices";
import { WindowsXpAppView } from "../ui/windows-xp/WindowsXpAppView";
import { GameController } from "./GameController";

const game = new GameController(createAppServices());

export interface AppProps {
  view?: ComponentType<{ game: GameController }>;
}

export function App({ view: View = WindowsXpAppView }: AppProps) {
  return <View game={game} />;
}
