import { useEffect, useEffectEvent, useRef, useState, type PointerEvent } from "react";
import type { GameplayData } from "../../library/GameplayLoader";
import type { GameplayBackgroundState, GameplaySession, ManiaPointerInput, OsuPointerInput } from "../../gameplay/GameplaySession";
import { createGameplaySession } from "../../gameplay/createGameplaySession";
import { bindOsuPointerAim, osuPointerMovementEvent } from "../../gameplay/osu/OsuPointerAimBinding";
import { ManiaTouchControls } from "./ManiaTouchControls";
import { bindOsuHardwareCursor } from "../../gameplay/osu/OsuHardwareCursor";
import type { CompletedGameplay } from "../../replay/RecordedReplay";
import { numberSetting } from "../../config/Config";
import { ConfigNumberControl } from "./ConfigNumberControl";
import {
  noteSkinOverrideKey,
  saveManiaColumnStartOverride,
  saveManiaComboPositionOverride,
  saveManiaHitPositionOverride,
  saveManiaJudgePositionOverride,
} from "../../noteskin/NoteSkinOverrides";
import { GameplayPerformanceGraph } from "../../gameplay/GameplayPerformance";
import type { GameplayConfiguration } from "../../gameplay/GameplayConfiguration";

const mania_hit_position = numberSetting("noteskin.mania.hit_position", 402, 0, 480, 1);
const mania_column_start = numberSetting("noteskin.mania.column_start", 136, 0, 854, 1);
const mania_judge_position = numberSetting("noteskin.mania.judge_position", 325, 0, 480, 1);
const mania_combo_position = numberSetting("noteskin.mania.combo_position", 111, 0, 480, 1);
const RESTART_HOLD_MS = 300;

interface GameplayScreenProps {
  assets: GameplayData;
  configuration: GameplayConfiguration;
  input_bindings: readonly (string | null)[];
  autoplay?: boolean;
  playback?: CompletedGameplay;
  note_skin_editor?: boolean;
  initial_lead_in?: number;
  onFinish: (completed: CompletedGameplay, reached_chart_end: boolean) => void;
  onBackgroundStateChange?: (state: GameplayBackgroundState) => void;
}

function NoteSkinEditorPanel({ assets }: { assets: GameplayData }) {
  const panel_ref = useRef<HTMLElement>(null);
  const drag_ref = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [hit_position, setHitPosition] = useState(() => assets.mode === "mania" ? assets.note_skin.config.hitPosition : 0);
  const [column_start, setColumnStart] = useState(() => assets.mode === "mania" ? assets.note_skin.config.columnStart : 0);
  const [judge_position, setJudgePosition] = useState(() => assets.mode === "mania" ? assets.note_skin.config.judgePosition : 0);
  const [combo_position, setComboPosition] = useState(() => assets.mode === "mania" ? assets.note_skin.config.comboPosition : 0);

  const startDrag = (event: PointerEvent<HTMLElement>) => {
    const panel = panel_ref.current;
    if (!panel) return;
    const bounds = panel.getBoundingClientRect();
    drag_ref.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
      minX: position.x - bounds.left,
      maxX: position.x + window.innerWidth - bounds.right,
      minY: position.y - bounds.top,
      maxY: position.y + window.innerHeight - bounds.bottom,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const drag = (event: PointerEvent<HTMLElement>) => {
    const state = drag_ref.current;
    if (!state || state.pointerId !== event.pointerId) return;
    setPosition({
      x: Math.min(state.maxX, Math.max(state.minX, state.originX + event.clientX - state.startX)),
      y: Math.min(state.maxY, Math.max(state.minY, state.originY + event.clientY - state.startY)),
    });
  };
  const stopDrag = (event: PointerEvent<HTMLElement>) => {
    if (drag_ref.current?.pointerId !== event.pointerId) return;
    drag_ref.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <aside ref={panel_ref} className="note-skin-editor-panel" style={{ transform: `translate(${position.x}px, ${position.y}px)` }}>
      <header className="note-skin-editor-titlebar" onPointerDown={startDrag} onPointerMove={drag}
        onPointerUp={stopDrag} onPointerCancel={stopDrag}>
        <h1>Note Skin Editor</h1>
      </header>
      <div className="note-skin-editor-content">
        {assets.mode === "mania" ? <>
          <ConfigNumberControl definition={mania_hit_position} label="Hit position" value={hit_position}
            onChange={(value) => {
              assets.note_skin.config.hitPosition = value;
              setHitPosition(value);
              saveManiaHitPositionOverride(noteSkinOverrideKey(assets.note_skin_id, "mania", assets.chart.column_count), value);
            }} onReset={() => {
              const value = assets.note_skin_source.hitPosition;
              assets.note_skin.config.hitPosition = value;
              setHitPosition(value);
              saveManiaHitPositionOverride(noteSkinOverrideKey(assets.note_skin_id, "mania", assets.chart.column_count), undefined);
            }} />
          <ConfigNumberControl definition={mania_judge_position} label="Judge Y" value={judge_position}
            onChange={(value) => {
              assets.note_skin.config.judgePosition = value;
              setJudgePosition(value);
              saveManiaJudgePositionOverride(noteSkinOverrideKey(assets.note_skin_id, "mania", assets.chart.column_count), value);
            }} onReset={() => {
              const value = assets.note_skin_source.judgePosition;
              assets.note_skin.config.judgePosition = value;
              setJudgePosition(value);
              saveManiaJudgePositionOverride(noteSkinOverrideKey(assets.note_skin_id, "mania", assets.chart.column_count), undefined);
            }} />
          <ConfigNumberControl definition={mania_combo_position} label="Combo Y" value={combo_position}
            onChange={(value) => {
              assets.note_skin.config.comboPosition = value;
              setComboPosition(value);
              saveManiaComboPositionOverride(noteSkinOverrideKey(assets.note_skin_id, "mania", assets.chart.column_count), value);
            }} onReset={() => {
              const value = assets.note_skin_source.comboPosition;
              assets.note_skin.config.comboPosition = value;
              setComboPosition(value);
              saveManiaComboPositionOverride(noteSkinOverrideKey(assets.note_skin_id, "mania", assets.chart.column_count), undefined);
            }} />
          <ConfigNumberControl definition={mania_column_start} label="Column start" value={column_start}
            onChange={(value) => {
              assets.note_skin.config.columnStart = value;
              setColumnStart(value);
              saveManiaColumnStartOverride(noteSkinOverrideKey(assets.note_skin_id, "mania", assets.chart.column_count), value);
            }} onReset={() => {
              const value = assets.note_skin_source.columnStart;
              assets.note_skin.config.columnStart = value;
              setColumnStart(value);
              saveManiaColumnStartOverride(noteSkinOverrideKey(assets.note_skin_id, "mania", assets.chart.column_count), undefined);
            }} />
        </> : <p>TODO</p>}
      </div>
    </aside>
  );
}

export function GameplayScreen({ assets, configuration, input_bindings,
  autoplay = false, playback, note_skin_editor = false, initial_lead_in = 0, onFinish,
  onBackgroundStateChange }: GameplayScreenProps) {
  const finish = useEffectEvent(onFinish);
  const backgroundStateChange = useEffectEvent((state: GameplayBackgroundState) => onBackgroundStateChange?.(state));
  const canvas_ref = useRef<HTMLCanvasElement>(null);
  const performance_canvas_ref = useRef<HTMLCanvasElement>(null);
  const performance_graph_ref = useRef<GameplayPerformanceGraph | null>(null);
  const session_ref = useRef<GameplaySession | null>(null);
  const mania_input_ref = useRef<ManiaPointerInput | null>(null);
  const osu_input_ref = useRef<OsuPointerInput | null>(null);
  const restart_timeout_ref = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [restart_revision, setRestartRevision] = useState(0);
  const [restart_holding, setRestartHolding] = useState(false);
  const [performance_graph_visible, setPerformanceGraphVisible] = useState(false);

  const cancelRestartHold = () => {
    if (restart_timeout_ref.current !== null) clearTimeout(restart_timeout_ref.current);
    restart_timeout_ref.current = null;
    setRestartHolding(false);
  };

  const beginRestartHold = () => {
    if (restart_timeout_ref.current !== null) return;
    setRestartHolding(true);
    restart_timeout_ref.current = setTimeout(() => {
      restart_timeout_ref.current = null;
      setRestartHolding(false);
      setRestartRevision((revision) => revision + 1);
    }, RESTART_HOLD_MS);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "F3") {
        event.preventDefault();
        setPerformanceGraphVisible((visible) => !visible);
        return;
      }
      if (event.code !== "Backquote") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) beginRestartHold();
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Backquote") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelRestartHold();
    };
    const handleBlur = () => cancelRestartHold();
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
      window.removeEventListener("blur", handleBlur);
      if (restart_timeout_ref.current !== null) clearTimeout(restart_timeout_ref.current);
    };
  }, []);

  useEffect(() => {
    const canvas = canvas_ref.current;
    const performance_canvas = performance_canvas_ref.current;
    if (!canvas || !performance_canvas) return;
    performance_graph_ref.current = new GameplayPerformanceGraph(performance_canvas);

    const effective_cursor_renderer = playback?.replay.mode === "osu" ? "webgl" : configuration.osu.cursor_renderer;
    const binding = createGameplaySession({ canvas, data: assets, configuration, input_bindings,
      autoplay, playback, initial_lead_in, finish, background_state_change: backgroundStateChange,
      performance_sample: (sample) => performance_graph_ref.current?.push(sample) });
    session_ref.current = binding.session;
    mania_input_ref.current = !playback && !autoplay && binding.mode === "mania" ? binding.pointer_input : null;
    osu_input_ref.current = !playback && !autoplay && binding.mode === "osu" ? binding.pointer_input : null;
    let unbind_pointer_aim: (() => void) | undefined;
    const unbind_hardware_cursor = !playback && !autoplay && assets.mode === "osu" && effective_cursor_renderer === "os"
      ? bindOsuHardwareCursor(canvas, assets.note_skin.cursor, configuration.osu.cursor_scale)
      : undefined;
    if (!playback && !autoplay && binding.mode === "osu") {
      unbind_pointer_aim = bindOsuPointerAim(binding.pointer_input,
        osuPointerMovementEvent(configuration.osu.raw_input, "onpointerrawupdate" in window), {
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
      performance_graph_ref.current = null;
      binding.session.destroy();
    };
  }, [assets, autoplay, configuration, initial_lead_in, input_bindings, playback, restart_revision]);

  return (
    <main className={`gameplay-screen${note_skin_editor ? " note-skin-editor-open" : ""}${restart_holding ? " restart-holding" : ""}`}>
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
      <canvas ref={performance_canvas_ref} className={`gameplay-performance-graph${performance_graph_visible ? "" : " hidden"}`}
        aria-hidden="true" />
      {!playback && !autoplay && assets.mode === "mania" &&
        <ManiaTouchControls column_count={assets.chart.column_count} input_ref={mania_input_ref} />}
      {note_skin_editor && <NoteSkinEditorPanel assets={assets} />}
    </main>
  );
}
