import { useEffect, useRef } from "react";
import type { GameplayData } from "../library/GameplayLoader";
import { GameplayRuntime } from "../gameplay/GameplayRuntime";
import type { HitRegistration } from "../gameplay/RhythmEngine";
import type { ScoreResult } from "../gameplay/scoring/ScoreEngine";
import type { ReplayBase } from "../replay/ReplayBase";

interface GameplayScreenProps {
  assets: GameplayData;
  master_volume: number;
  scroll_speed: number;
  replay_base: ReplayBase;
  input_bindings: readonly (string | null)[];
  hit_registration: HitRegistration;
  onFinish: (score: ScoreResult) => void;
}

export function GameplayScreen({ assets, master_volume, scroll_speed, replay_base, input_bindings, hit_registration, onFinish }: GameplayScreenProps) {
  const canvas_ref = useRef<HTMLCanvasElement>(null);
  const accuracy_ref = useRef<HTMLSpanElement>(null);
  const judge_ref = useRef<HTMLSpanElement>(null);
  const combo_ref = useRef<HTMLSpanElement>(null);
  const runtime_ref = useRef<GameplayRuntime>(null);

  useEffect(() => {
    const canvas = canvas_ref.current;
    const accuracy = accuracy_ref.current;
    const judge = judge_ref.current;
    const combo = combo_ref.current;

    if (!canvas || !accuracy || !judge || !combo) {
      return;
    }

    const runtime = new GameplayRuntime(canvas, accuracy, judge, combo, assets, master_volume, scroll_speed, replay_base,
      input_bindings, hit_registration, onFinish);
    runtime_ref.current = runtime;
    runtime.start();

    return () => {
      runtime_ref.current = null;
      runtime.destroy();
    };
  }, [assets, hit_registration, input_bindings, master_volume, onFinish, replay_base, scroll_speed]);

  return (
    <main className="gameplay-screen">
      <canvas ref={canvas_ref} />
      <div className="gameplay-touch-zones" aria-label="Gameplay touch controls">
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
              runtime_ref.current?.pressPointer(event.pointerId, column, event.timeStamp);
            }}
            onPointerUp={(event) => {
              if (event.pointerType === "mouse") return;
              event.preventDefault();
              runtime_ref.current?.releasePointer(event.pointerId, event.timeStamp);
            }}
            onPointerCancel={(event) => runtime_ref.current?.releasePointer(event.pointerId, event.timeStamp)}
            onLostPointerCapture={(event) => runtime_ref.current?.releasePointer(event.pointerId, event.timeStamp)}
          />
        ))}
      </div>
      <span ref={accuracy_ref} className="gameplay-accuracy">0.00%</span>
      <div className="gameplay-judgment">
        <span ref={judge_ref} className="gameplay-judge" />
        <span ref={combo_ref} className="gameplay-combo">0x</span>
      </div>
    </main>
  );
}
