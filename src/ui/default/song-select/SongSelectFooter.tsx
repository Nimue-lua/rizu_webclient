import { useRef, type CSSProperties } from "react";
import { useHoverRangeKeys } from "../RangeInput";
import { SongSelectIcon } from "./SongSelectUi";

interface SongSelectFooterProps {
  mode: "osu" | "mania" | null;
  constant_scroll: boolean;
  music_rate: number;
  osu_approach_rate: number | null;
  osu_circle_size: number | null;
  osu_overall_difficulty: number | null;
  selected_chart_available: boolean;
  tap_only: boolean;
  onMusicRateChange: (music_rate: number) => void;
  onOpenInputs: () => void;
  onOpenModifiers: () => void;
  onOpenSkins: () => void;
  onExit: () => void;
  onPlay: () => void;
}

export function SongSelectFooter({ mode, constant_scroll, music_rate, osu_approach_rate, osu_circle_size,
  osu_overall_difficulty, selected_chart_available, tap_only,
  onMusicRateChange, onOpenInputs, onOpenModifiers, onOpenSkins, onExit, onPlay }: SongSelectFooterProps) {
  const rate_drag_ref = useRef<{ pointer_id: number; start_x: number; start_rate: number } | null>(null);
  const speed_progress = (music_rate - 0.25) / 3.75;
  const speed_style = {
    "--rate-angle": `${speed_progress * 270}deg`,
    "--rate-rotation": `${-135 + speed_progress * 270}deg`,
  } as CSSProperties;
  const hover_key_handlers = useHoverRangeKeys(music_rate, 0.25, 4, 0.05, onMusicRateChange);
  const modifier_count = mode === "osu"
    ? Number(osu_approach_rate !== null) + Number(osu_circle_size !== null) + Number(osu_overall_difficulty !== null)
    : mode === "mania" ? Number(constant_scroll) + Number(tap_only) : 0;

  const moveRateDrag = (client_x: number) => {
    const drag = rate_drag_ref.current;
    if (!drag) return;
    const value = drag.start_rate + (client_x - drag.start_x) / 360 * 3.75;
    onMusicRateChange(Math.min(4, Math.max(0.25, Math.round(value / 0.05) * 0.05)));
  };

  return (
    <footer className="song-select-footer">
      <button className="back-control" type="button" onClick={onExit}><SongSelectIcon name="undo" /><span>BACK</span></button>
      <nav className="loadout-controls" aria-label="Loadout">
        <button className={`mods${modifier_count > 0 ? " active" : ""}`} aria-haspopup="dialog" onClick={onOpenModifiers}><SongSelectIcon name="puzzle" /><span>MODS</span><b>{modifier_count}</b></button>
        <button className="mutators"><SongSelectIcon name="zap" /><span>MUTATORS</span><b>0</b></button>
        <button className="inputs" disabled={!selected_chart_available} onClick={onOpenInputs}><SongSelectIcon name="keyboard" /><span>INPUTS</span></button>
        <button className="skins" aria-haspopup="dialog" onClick={onOpenSkins}><SongSelectIcon name="paintbrush" /><span>SKINS</span></button>
      </nav>
      <div className="play-controls">
        <div className="play-modifiers"><strong>MUSIC SPEED</strong><label className="rate-control"><output htmlFor="music-rate">{music_rate.toFixed(2)}x</output>
          <span className="rate-knob" style={speed_style} onWheel={(event) => {
            event.preventDefault();
            const offset = event.deltaY < 0 ? 0.05 : -0.05;
            onMusicRateChange(Math.min(4, Math.max(0.25, Math.round((music_rate + offset) * 100) / 100)));
          }}><span /><input {...hover_key_handlers} id="music-rate" type="range" min="0.25" max="4" step="0.05" value={music_rate} aria-label="Music speed" onChange={(event) => onMusicRateChange(Number(event.target.value))} onPointerDown={(event) => { event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); rate_drag_ref.current = { pointer_id: event.pointerId, start_x: event.clientX, start_rate: music_rate }; }} onPointerMove={(event) => { if (rate_drag_ref.current?.pointer_id === event.pointerId) moveRateDrag(event.clientX); }} onPointerUp={(event) => { if (rate_drag_ref.current?.pointer_id === event.pointerId) rate_drag_ref.current = null; }} onPointerCancel={(event) => { if (rate_drag_ref.current?.pointer_id === event.pointerId) rate_drag_ref.current = null; }} /></span>
        </label></div>
        <button className="play-control" disabled={!selected_chart_available} onClick={onPlay}><span>PLAY</span><SongSelectIcon name="play" /></button>
      </div>
    </footer>
  );
}
