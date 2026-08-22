import { useEffect, useRef } from "react";
import type { LoadedGameplayAssets } from "../assets/GameplayAssetProvider";
import { GameplayRuntime } from "../gameplay/GameplayRuntime";

interface GameplayScreenProps {
  assets: LoadedGameplayAssets;
  master_volume: number;
  scroll_speed: number;
  input_bindings: readonly (string | null)[];
  onFinish: () => void;
}

export function GameplayScreen({ assets, master_volume, scroll_speed, input_bindings, onFinish }: GameplayScreenProps) {
  const canvas_ref = useRef<HTMLCanvasElement>(null);
  const fps_ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const canvas = canvas_ref.current;
    const fps = fps_ref.current;

    if (!canvas || !fps) {
      return;
    }

    const runtime = new GameplayRuntime(canvas, fps, assets, master_volume, scroll_speed, input_bindings, onFinish);
    runtime.start();

    return () => runtime.destroy();
  }, [assets, input_bindings, master_volume, onFinish, scroll_speed]);

  return (
    <main className="gameplay-screen">
      <canvas ref={canvas_ref} />
      <span ref={fps_ref} className="fps-counter">0 FPS</span>
      <span className="gameplay-hint">Escape: results</span>
    </main>
  );
}
