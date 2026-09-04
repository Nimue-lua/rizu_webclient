import { lazy, Suspense, type ComponentType } from "react";
import { createAppServices } from "./controller/AppServices";
import { appSettings, settings } from "../config/Settings";
import { GameController } from "./GameController";

const game = new GameController(createAppServices());
const DefaultAppView = lazy(() => import("../ui/default/DefaultAppView")
  .then(({ DefaultAppView }) => ({ default: DefaultAppView })));
const WindowsXpAppView = lazy(() => import("../ui/windows-xp/WindowsXpAppView")
  .then(({ WindowsXpAppView }) => ({ default: WindowsXpAppView })));

export interface AppProps {
  view?: ComponentType<{ game: GameController }>;
}

export function App({ view: View }: AppProps) {
  if (View) return <View game={game} />;

  const ConfiguredView = appSettings.get(settings.user_interface) === "default" ? DefaultAppView : WindowsXpAppView;
  return <Suspense fallback={null}><ConfiguredView game={game} /></Suspense>;
}
