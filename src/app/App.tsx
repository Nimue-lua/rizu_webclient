import type { ComponentType } from "react";
import { createAppServices } from "./controller/AppServices";
import { DefaultAppView } from "../ui/default/DefaultAppView";
import { GameController } from "./GameController";

const game = new GameController(createAppServices());

export interface AppProps {
  view?: ComponentType<{ game: GameController }>;
}

export function App({ view: View = DefaultAppView }: AppProps) {
  return <View game={game} />;
}
