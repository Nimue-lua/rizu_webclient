import { useEffect, useRef } from "react";
import type { GameplayData } from "../library/GameplayLoader";
import type { ManiaHitRegistration } from "../gameplay/mania/ManiaRulesEngine";
import type { ManiaReplayBase } from "../replay/mania/ManiaReplayBase";
import type { GameplaySession, ManiaPointerInput, OsuPointerInput } from "../gameplay/GameplaySession";
import { createGameplaySession } from "../gameplay/createGameplaySession";
import { bindOsuPointerAim, osuPointerMovementEvent } from "../gameplay/osu/OsuPointerAimBinding";
import { ManiaTouchControls } from "./ManiaTouchControls";
import type { OsuSliderRendererMode } from "../gameplay/osu/rendering/WebGlSliderGraphics";
import { bindOsuHardwareCursor, type OsuCursorRendererMode } from "../gameplay/osu/OsuHardwareCursor";
import type { CompletedGameplay } from "../replay/RecordedReplay";

interface GameplayScreenProps {
  assets: GameplayData;
  master_volume: number;
  osu_hit_sound_volume: number;
  music_offset: number;
  scroll_speed: number;
  cursor_scale: number;
  osu_cursor_renderer: OsuCursorRendererMode;
  osu_raw_input: boolean;
  osu_slider_renderer: OsuSliderRendererMode;
  replay_base: ManiaReplayBase;
  input_bindings: readonly (string | null)[];
  hit_registration: ManiaHitRegistration;
  onFinish: (completed: CompletedGameplay) => void;
}

export function GameplayScreen({ assets, master_volume, osu_hit_sound_volume, music_offset, scroll_speed, cursor_scale,
  osu_cursor_renderer, osu_raw_input, osu_slider_renderer, replay_base, input_bindings, hit_registration,
  onFinish }: GameplayScreenProps) {
  const canvas_ref = useRef<HTMLCanvasElement>(null);
  const session_ref = useRef<GameplaySession | null>(null);
  const mania_input_ref = useRef<ManiaPointerInput | null>(null);
  const osu_input_ref = useRef<OsuPointerInput | null>(null);

  useEffect(() => {
    const canvas = canvas_ref.current;
    if (!canvas) return;

    const binding = createGameplaySession({ canvas, data: assets, master_volume, osu_hit_sound_volume, music_offset, scroll_speed,
      cursor_scale, osu_cursor_renderer, osu_slider_renderer, replay_base, input_bindings, hit_registration, finish: onFinish });
    session_ref.current = binding.session;
    mania_input_ref.current = binding.mode === "mania" ? binding.pointer_input : null;
    osu_input_ref.current = binding.mode === "osu" ? binding.pointer_input : null;
    let unbind_pointer_aim: (() => void) | undefined;
    const unbind_hardware_cursor = assets.mode === "osu" && osu_cursor_renderer === "os"
      ? bindOsuHardwareCursor(canvas, assets.note_skin.cursor, cursor_scale)
      : undefined;
    if (binding.mode === "osu") {
      unbind_pointer_aim = bindOsuPointerAim(binding.pointer_input,
        osuPointerMovementEvent(osu_raw_input, "onpointerrawupdate" in window), {
          event_target: canvas,
          get_bounds: () => canvas.getBoundingClientRect(),
          observe_resize: (refreshBounds) => {
            const resize_observer = new ResizeObserver(refreshBounds);
            resize_observer.observe(canvas);
            return () => resize_observer.disconnect();
          },
        });
    }
    binding.session.start();

    return () => {
      unbind_pointer_aim?.();
      unbind_hardware_cursor?.();
      session_ref.current = null;
      mania_input_ref.current = null;
      osu_input_ref.current = null;
      binding.session.destroy();
    };
  }, [assets, cursor_scale, hit_registration, input_bindings, master_volume, music_offset, onFinish, osu_cursor_renderer,
    osu_raw_input, osu_hit_sound_volume, osu_slider_renderer, replay_base, scroll_speed]);

  return (
    <main className="gameplay-screen">
      <canvas ref={canvas_ref}
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
