import { useState } from "react";
import {
  HttpGameplayAssetProvider,
  type LoadedGameplayAssets,
} from "../assets/GameplayAssetProvider";
import { HttpChartCatalogProvider } from "../assets/ChartCatalogProvider";
import { SqliteCatalogProvider } from "../catalog/CatalogProvider";
import { GameplayScreen } from "./GameplayScreen";
import { LoadingScreen } from "./LoadingScreen";
import { ResultScreen } from "./ResultScreen";
import { SongSelectScreen } from "./SongSelectScreen";

type Screen = "song-select" | "loading" | "gameplay" | "result";
const asset_provider = new HttpGameplayAssetProvider();
const catalog_provider = new HttpChartCatalogProvider();
const song_catalog_provider = new SqliteCatalogProvider();

export function App() {
  const [screen, setScreen] = useState<Screen>("song-select");
  const [audio_context, setAudioContext] = useState<AudioContext | null>(null);
  const [assets, setAssets] = useState<LoadedGameplayAssets | null>(null);
  const [selected_song_id, setSelectedSongId] = useState<string | null>(null);
  const [loading_song_id, setLoadingSongId] = useState<string | null>(null);
  const [scroll_speed, setScrollSpeed] = useState(1200);

  const beginLoading = (song_id: string) => {
    setLoadingSongId(song_id);
    setAudioContext(new AudioContext());
    setScreen("loading");
  };

  const cancelLoading = () => {
    if (audio_context) {
      void audio_context.close();
    }

    setAudioContext(null);
    setLoadingSongId(null);
    setScreen("song-select");
  };

  const finishLoading = (loaded_assets: LoadedGameplayAssets) => {
    setAssets(loaded_assets);
    setScreen("gameplay");
  };

  const leaveResults = () => {
    if (audio_context) {
      void audio_context.close();
    }

    setAssets(null);
    setAudioContext(null);
    setLoadingSongId(null);
    setScreen("song-select");
  };

  switch (screen) {
    case "gameplay":
      if (!assets) {
        throw new Error("Gameplay assets are not loaded");
      }

      return (
        <GameplayScreen
          assets={assets}
          scroll_speed={scroll_speed}
          onFinish={() => setScreen("result")}
        />
      );
    case "loading":
      if (!audio_context || !loading_song_id) {
        throw new Error("Gameplay loading is not initialized");
      }

      return (
        <LoadingScreen
          asset_provider={asset_provider}
          catalog_provider={catalog_provider}
          song_id={loading_song_id}
          audio_context={audio_context}
          onCancel={cancelLoading}
          onLoaded={finishLoading}
        />
      );
    case "result":
      return <ResultScreen onExit={leaveResults} />;
    case "song-select":
      return (
        <SongSelectScreen
          catalog_provider={song_catalog_provider}
          selected_song_id={selected_song_id}
          scroll_speed={scroll_speed}
          onPlay={beginLoading}
          onSongSelect={setSelectedSongId}
          onScrollSpeedChange={setScrollSpeed}
        />
      );
  }
}
