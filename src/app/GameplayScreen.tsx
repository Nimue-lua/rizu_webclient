import { useEffect, useRef } from "react";
import { isOsuGameplayData, type GameplayData } from "../library/GameplayLoader";
import { GameplayRuntime } from "../gameplay/GameplayRuntime";
import { OsuGameplayRuntime } from "../gameplay/OsuGameplayRuntime";
import type { HitRegistration } from "../gameplay/RhythmEngine";
import type { ScoreResult } from "../gameplay/scoring/ScoreEngine";
import type { ReplayBase } from "../replay/ReplayBase";

interface GameplayScreenProps {
  assets: GameplayData;
  master_volume: number;
  music_offset: number;
  scroll_speed: number;
  replay_base: ReplayBase;
  input_bindings: readonly (string | null)[];
  hit_registration: HitRegistration;
  onFinish: (score: ScoreResult) => void;
}

export function GameplayScreen({ assets, master_volume, music_offset, scroll_speed, replay_base, input_bindings, hit_registration, onFinish }: GameplayScreenProps) {
  const canvas_ref = useRef<HTMLCanvasElement>(null);
  const runtime_ref = useRef<{ start(): void; destroy(): void; pressPointer?(pointer_id: number, column: number, performance_time: number): void;
    releasePointer?(pointer_id: number, performance_time: number): void } | null>(null);

  useEffect(() => {
    const canvas = canvas_ref.current;
    if (!canvas) return;

    const runtime = isOsuGameplayData(assets)
      ? new OsuGameplayRuntime(canvas, assets, master_volume, music_offset, replay_base, onFinish)
      : new GameplayRuntime(canvas, assets, master_volume, music_offset, scroll_speed, replay_base,
        input_bindings, hit_registration, onFinish);
    runtime_ref.current = runtime;
    runtime.start();

    return () => {
      runtime_ref.current = null;
      runtime.destroy();
    };
  }, [assets, hit_registration, input_bindings, master_volume, music_offset, onFinish, replay_base, scroll_speed]);

  return (
    <main className="gameplay-screen">
      <canvas ref={canvas_ref} />
      {assets.chart.mode === "mania" && <div className="gameplay-touch-zones" aria-label="Gameplay touch controls">
        {Array.from({ length: assets.chart.column_count }, (_, column) => (
          <button
            key={column}
            type="button"
            tabIndex={-1}
            aria-label={`Column ${column + 1}`}
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => {
              if (event.pointerType === "mouse") return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              runtime_ref.current?.pressPointer?.(event.pointerId, column, event.timeStamp);
            }}
            onPointerUp={(event) => {
              if (event.pointerType === "mouse") return;
              event.preventDefault();
              runtime_ref.current?.releasePointer?.(event.pointerId, event.timeStamp);
            }}
            onPointerCancel={(event) => runtime_ref.current?.releasePointer?.(event.pointerId, event.timeStamp)}
            onLostPointerCapture={(event) => runtime_ref.current?.releasePointer?.(event.pointerId, event.timeStamp)}
          />
        ))}
      </div>}
    </main>
  );
}
