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
import { SettingsScreen } from "./SettingsScreen";
import { SongSelectScreen } from "./SongSelectScreen";

type Screen = "song-select" | "loading" | "gameplay" | "result";
const MASTER_VOLUME_KEY = "rizu.master-volume";
const SCROLL_SPEED_KEY = "rizu.scroll-speed";
const asset_provider = new HttpGameplayAssetProvider();
const catalog_provider = new HttpChartCatalogProvider();
const song_catalog_provider = new SqliteCatalogProvider();

export function App() {
  const [screen, setScreen] = useState<Screen>("song-select");
  const [settings_open, setSettingsOpen] = useState(false);
  const [audio_context, setAudioContext] = useState<AudioContext | null>(null);
  const [assets, setAssets] = useState<LoadedGameplayAssets | null>(null);
  const [selected_song_id, setSelectedSongId] = useState<string | null>(null);
  const [loading_chart_id, setLoadingChartId] = useState<string | null>(null);
  const [input_bindings, setInputBindings] = useState<readonly (string | null)[]>([]);
  const [master_volume, setMasterVolume] = useState(() => {
    const stored_setting = localStorage.getItem(MASTER_VOLUME_KEY);
    const stored_value = stored_setting === null ? Number.NaN : Number(stored_setting);
    return Number.isFinite(stored_value) && stored_value >= 0 && stored_value <= 1 ? stored_value : 0.2;
  });
  const [scroll_speed, setScrollSpeed] = useState(() => {
    const stored_setting = localStorage.getItem(SCROLL_SPEED_KEY);
    const stored_value = stored_setting === null ? Number.NaN : Number(stored_setting);
    return Number.isFinite(stored_value) && stored_value >= 100 && stored_value <= 4000 ? stored_value : 1200;
  });

  const changeMasterVolume = (value: number) => {
    localStorage.setItem(MASTER_VOLUME_KEY, String(value));
    setMasterVolume(value);
  };

  const changeScrollSpeed = (value: number) => {
    localStorage.setItem(SCROLL_SPEED_KEY, String(value));
    setScrollSpeed(value);
  };

  const beginLoading = (chart_id: string, chart_input_bindings: readonly (string | null)[]) => {
    setLoadingChartId(chart_id);
    setInputBindings(chart_input_bindings);
    setAudioContext(new AudioContext());
    setScreen("loading");
  };

  const cancelLoading = () => {
    if (audio_context) {
      void audio_context.close();
    }

    setAudioContext(null);
    setLoadingChartId(null);
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
    setLoadingChartId(null);
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
          master_volume={master_volume}
          scroll_speed={scroll_speed}
          input_bindings={input_bindings}
          onFinish={() => setScreen("result")}
        />
      );
    case "loading":
      if (!audio_context || !loading_chart_id) {
        throw new Error("Gameplay loading is not initialized");
      }

      return (
        <LoadingScreen
          asset_provider={asset_provider}
          catalog_provider={catalog_provider}
          chart_id={loading_chart_id}
          audio_context={audio_context}
          onCancel={cancelLoading}
          onLoaded={finishLoading}
        />
      );
    case "result":
      return <ResultScreen onExit={leaveResults} />;
    case "song-select":
      return (
        <>
          <SongSelectScreen
            catalog_provider={song_catalog_provider}
            selected_song_id={selected_song_id}
            master_volume={master_volume}
            scroll_speed={scroll_speed}
            onPlay={beginLoading}
            onSettings={() => setSettingsOpen(true)}
            onSongSelect={setSelectedSongId}
            onScrollSpeedChange={changeScrollSpeed}
          />
          {settings_open && (
            <SettingsScreen
              master_volume={master_volume}
              scroll_speed={scroll_speed}
              onMasterVolumeChange={changeMasterVolume}
              onScrollSpeedChange={changeScrollSpeed}
              onExit={() => setSettingsOpen(false)}
            />
          )}
        </>
      );
  }
}
