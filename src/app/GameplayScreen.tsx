import { useEffect, useRef } from "react";
import type { LoadedGameplayAssets } from "../assets/GameplayAssetProvider";
import { GameplayRuntime } from "../gameplay/GameplayRuntime";

interface GameplayScreenProps {
  assets: LoadedGameplayAssets;
  scroll_speed: number;
  onFinish: () => void;
}

export function GameplayScreen({ assets, scroll_speed, onFinish }: GameplayScreenProps) {
  const canvas_ref = useRef<HTMLCanvasElement>(null);
  const fps_ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const canvas = canvas_ref.current;
    const fps = fps_ref.current;

    if (!canvas || !fps) {
      return;
    }

    const runtime = new GameplayRuntime(canvas, fps, assets, scroll_speed, onFinish);
    runtime.start();

    return () => runtime.destroy();
  }, [assets, onFinish, scroll_speed]);

  return (
    <main className="gameplay-screen">
      <canvas ref={canvas_ref} />
      <span ref={fps_ref} className="fps-counter">0 FPS</span>
      <span className="gameplay-hint">Escape: results</span>
    </main>
  );
}
