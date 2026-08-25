import { useEffect, useRef } from "react";
import type { GameplayData } from "../library/GameplayLoader";
import type { ManiaHitRegistration } from "../gameplay/ManiaRulesEngine";
import type { ScoreResult } from "../gameplay/scoring/ScoreResult";
import type { ReplayBase } from "../replay/ReplayBase";
import type { GameplaySession, ManiaPointerInput, OsuPointerInput } from "../gameplay/GameplaySession";
import { createGameplaySession } from "../gameplay/createGameplaySession";
import { ManiaTouchControls } from "./ManiaTouchControls";

interface GameplayScreenProps {
  assets: GameplayData;
  master_volume: number;
  music_offset: number;
  scroll_speed: number;
  cursor_scale: number;
  replay_base: ReplayBase;
  input_bindings: readonly (string | null)[];
  hit_registration: ManiaHitRegistration;
  onFinish: (score: ScoreResult) => void;
}

export function GameplayScreen({ assets, master_volume, music_offset, scroll_speed, cursor_scale, replay_base, input_bindings, hit_registration, onFinish }: GameplayScreenProps) {
  const canvas_ref = useRef<HTMLCanvasElement>(null);
  const session_ref = useRef<GameplaySession | null>(null);
  const mania_input_ref = useRef<ManiaPointerInput | null>(null);
  const osu_input_ref = useRef<OsuPointerInput | null>(null);

  useEffect(() => {
    const canvas = canvas_ref.current;
    if (!canvas) return;

    const binding = createGameplaySession({ canvas, data: assets, master_volume, music_offset, scroll_speed,
      cursor_scale, replay_base, input_bindings, hit_registration, finish: onFinish });
    session_ref.current = binding.session;
    mania_input_ref.current = binding.mode === "mania" ? binding.pointer_input : null;
    osu_input_ref.current = binding.mode === "osu" ? binding.pointer_input : null;
    binding.session.start();

    return () => {
      session_ref.current = null;
      mania_input_ref.current = null;
      osu_input_ref.current = null;
      binding.session.destroy();
    };
  }, [assets, cursor_scale, hit_registration, input_bindings, master_volume, music_offset, onFinish, replay_base, scroll_speed]);

  return (
    <main className="gameplay-screen">
      <canvas ref={canvas_ref}
        onPointerMove={(event) => {
          const input = osu_input_ref.current;
          if (!input) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          input.aimPointer(event.pointerId, event.clientX, event.clientY, bounds, event.timeStamp);
        }}
        onPointerDown={(event) => {
          const input = osu_input_ref.current;
          if (!input) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          const bounds = event.currentTarget.getBoundingClientRect();
          input.aimPointer(event.pointerId, event.clientX, event.clientY, bounds, event.timeStamp);
          input.pressPointer(event.pointerId, event.button === 2 ? "secondary" : "primary", event.timeStamp);
        }}
        onPointerUp={(event) => {
          const input = osu_input_ref.current;
          if (!input) return;
          input.releasePointer(event.pointerId, event.button === 2 ? "secondary" : "primary", event.timeStamp);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={(event) => osu_input_ref.current?.cancelPointer(event.pointerId, event.timeStamp)}
        onLostPointerCapture={(event) => osu_input_ref.current?.cancelPointer(event.pointerId, event.timeStamp)}
        onContextMenu={(event) => assets.mode === "osu" && event.preventDefault()}
      />
      {assets.mode === "mania" && <ManiaTouchControls column_count={assets.chart.column_count} input_ref={mania_input_ref} />}
    </main>
  );
}
