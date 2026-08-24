import { useEffect, useRef } from "react";
import type { GameplayData } from "../library/GameplayLoader";
import type { ManiaHitRegistration } from "../gameplay/ManiaRulesEngine";
import type { ScoreResult } from "../gameplay/scoring/ScoreResult";
import type { ReplayBase } from "../replay/ReplayBase";
import type { GameplaySession, ManiaPointerInput } from "../gameplay/GameplaySession";
import { createGameplaySession } from "../gameplay/createGameplaySession";
import { ManiaTouchControls } from "./ManiaTouchControls";

interface GameplayScreenProps {
  assets: GameplayData;
  master_volume: number;
  music_offset: number;
  scroll_speed: number;
  replay_base: ReplayBase;
  input_bindings: readonly (string | null)[];
  hit_registration: ManiaHitRegistration;
  onFinish: (score: ScoreResult) => void;
}

export function GameplayScreen({ assets, master_volume, music_offset, scroll_speed, replay_base, input_bindings, hit_registration, onFinish }: GameplayScreenProps) {
  const canvas_ref = useRef<HTMLCanvasElement>(null);
  const session_ref = useRef<GameplaySession | null>(null);
  const mania_input_ref = useRef<ManiaPointerInput | null>(null);

  useEffect(() => {
    const canvas = canvas_ref.current;
    if (!canvas) return;

    const binding = createGameplaySession({ canvas, data: assets, master_volume, music_offset, scroll_speed,
      replay_base, input_bindings, hit_registration, finish: onFinish });
    session_ref.current = binding.session;
    mania_input_ref.current = binding.mode === "mania" ? binding.pointer_input : null;
    binding.session.start();

    return () => {
      session_ref.current = null;
      mania_input_ref.current = null;
      binding.session.destroy();
    };
  }, [assets, hit_registration, input_bindings, master_volume, music_offset, onFinish, replay_base, scroll_speed]);

  return (
    <main className="gameplay-screen">
      <canvas ref={canvas_ref} />
      {assets.mode === "mania" && <ManiaTouchControls column_count={assets.chart.column_count} input_ref={mania_input_ref} />}
    </main>
  );
}
