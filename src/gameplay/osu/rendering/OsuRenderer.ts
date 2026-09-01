import type { OsuChart } from "../../../chart/Chart";
import type { GameplayPresentationState } from "../../HudState";
import { getGameplayHudLayout, type GameplayHudRenderer } from "../../GameplayHudRenderer";
import { SpriteGameplayHudRenderer } from "../../renderer/GameplayHudRenderer";
import { OsuComboRenderer } from "./OsuComboRenderer";
import { OsuPlayfieldRenderer } from "./OsuPlayfieldRenderer";
import type { OsuStandardSkin } from "../../../noteskin/osu/OsuSkin";
import type { SpriteDrawCommand } from "../../renderer/Sprite";
import { WebGlSpriteGraphics } from "../../renderer/WebGlSpriteGraphics";
import type { GameplayFrame } from "../../renderer/GameplayFrame";
import { OsuViewport, type ClientBounds, type Point } from "../OsuViewport";
import type { OsuCursorState } from "../OsuInputEvent";
import type { OsuCircleTransient } from "../OsuCirclePresentation";
import type { OsuSlider } from "../../../chart/Chart";
import type { OsuSliderPath } from "../OsuSliderPath";
import { osuCircleDiameter } from "../OsuCircleGeometry";
import { WebGlSliderGraphics } from "./WebGlSliderGraphics";
import type { OsuSliderPresentationState, OsuSpinnerPresentationState } from "../OsuSliderPresentation";

export interface OsuGameplayRenderer {
  clientToPlayfield(point: Point, bounds: ClientBounds): Point;
  draw(chart: OsuChart, circle_states: Uint8Array, first_active_index: number,
    circle_transients: readonly OsuCircleTransient[], song_time: number,
    state: GameplayPresentationState, cursor: OsuCursorState,
    slider_states?: readonly OsuSliderPresentationState[], spinner_state?: OsuSpinnerPresentationState | null,
    progress?: number | null): number;
  destroy(): void;
}

export class OsuRenderer implements OsuGameplayRenderer {
  // Osu-specific GPU resources, including future slider mesh caches, belong to this renderer and its destroy boundary.
  private readonly playfield: OsuPlayfieldRenderer;
  private readonly combo: OsuComboRenderer;
  private readonly graphics: WebGlSpriteGraphics;
  private readonly slider_graphics: WebGlSliderGraphics;
  private readonly hud: GameplayHudRenderer;
  private readonly commands: SpriteDrawCommand[] = [];
  private active_commands: SpriteDrawCommand[] | null = null;
  private active_viewport: OsuViewport | null = null;
  private active_frame: GameplayFrame | null = null;
  private slider_draw_calls = 0;
  private readonly skin: OsuStandardSkin;
  private readonly x_flip: boolean;
  private readonly y_flip: boolean;
  private readonly cursor_scale: number;
  private readonly draw_cursor: boolean;
  private readonly slider_paths = new Map<OsuSlider, OsuSliderPath>();

  constructor(canvas: HTMLCanvasElement, skin: OsuStandardSkin, hud?: GameplayHudRenderer,
    x_flip = false, y_flip = false, cursor_scale = 1, draw_cursor = true,
    chart?: OsuChart, prepared_slider_paths?: ReadonlyMap<OsuSlider, OsuSliderPath>) {
    this.skin = skin;
    this.x_flip = x_flip;
    this.y_flip = y_flip;
    this.cursor_scale = cursor_scale;
    this.draw_cursor = draw_cursor;
    this.playfield = new OsuPlayfieldRenderer(skin);
    this.combo = new OsuComboRenderer(skin);
    this.graphics = new WebGlSpriteGraphics(canvas, skin);
    this.slider_graphics = new WebGlSliderGraphics(canvas);
    this.hud = hud ?? new SpriteGameplayHudRenderer(skin, this.writeHudCommand);
    if (chart && prepared_slider_paths) this.prepareSliders(chart, prepared_slider_paths);
  }

  clientToPlayfield(point: Point, bounds: ClientBounds): Point {
    const frame = this.graphics.getFrame();
    return this.createViewport(frame.logical_width, frame.logical_height).clientToPlayfield(point, bounds);
  }

  draw(chart: OsuChart, circle_states: Uint8Array, first_active_index: number,
    circle_transients: readonly OsuCircleTransient[], song_time: number,
    state: GameplayPresentationState, cursor: OsuCursorState,
    slider_states: readonly OsuSliderPresentationState[] | undefined = undefined,
    spinner_state: OsuSpinnerPresentationState | null = null, progress: number | null = null): number {
    const frame = this.graphics.getFrame();
    this.graphics.beginFrame(frame);
    this.slider_draw_calls = 0;
    const commands = this.commands;
    commands.length = 0;
    this.active_commands = commands;
    const viewport = this.createViewport(frame.logical_width, frame.logical_height);
    this.active_viewport = viewport;
    this.active_frame = frame;
    this.hud.drawHpBar();
    this.playfield.draw(viewport, chart, circle_states, first_active_index, circle_transients, song_time,
      this.writeCommand, this.sliderPath, this.drawSlider, slider_states, spinner_state);
    this.combo.draw(state.combo, state.comboAnimationAge, state.comboAnimationFrom,
      8, frame.logical_height - 8, this.writeCommand);
    this.hud.drawScore(state.hud, getGameplayHudLayout(frame.logical_width));
    this.hud.drawProgress(progress, getGameplayHudLayout(frame.logical_width));
    if (this.draw_cursor) {
      const cursor_center = viewport.playfieldToScreen(cursor.position);
      const cursor_scale = this.cursor_scale * (cursor.primary || cursor.secondary ? 0.9 : 1);
      const cursor_width = this.skin.cursor.sourceSize.w * viewport.scale * cursor_scale;
      const cursor_height = this.skin.cursor.sourceSize.h * viewport.scale * cursor_scale;
      this.writeCommand(cursor_center.x - cursor_width / 2, cursor_center.y - cursor_height / 2,
        cursor_width, cursor_height, [1, 1, 1, 1], this.skin.cursor);
    }
    this.active_commands = null;
    this.active_viewport = null;
    this.active_frame = null;
    this.graphics.submit(commands);
    return this.graphics.drawCallCount + this.slider_draw_calls;
  }

  private createViewport(width: number, height: number): OsuViewport {
    return new OsuViewport(width, height, this.x_flip, this.y_flip);
  }

  private prepareSliders(chart: OsuChart, paths: ReadonlyMap<OsuSlider, OsuSliderPath>): void {
    const radius = osuCircleDiameter(chart.circle_size) / 2;
    for (const [slider, path] of paths) {
      if (this.slider_graphics.upload(slider, path, radius)) this.slider_paths.set(slider, path);
    }
  }

  private readonly sliderPath = (slider: OsuSlider): OsuSliderPath | undefined => this.slider_paths.get(slider);

  private readonly writeCommand = (x: number, y: number, width: number, height: number,
    color: readonly [number, number, number, number], sprite: SpriteDrawCommand["sprite"],
    flip_y?: boolean, batch?: string, rotate_ccw?: boolean, rotation_radians?: number): void => {
    this.active_commands?.push({ x, y, width, height, color, sprite, flipY: flip_y ?? false,
      rotateCounterClockwise: rotate_ccw ?? false, rotationRadians: rotation_radians ?? 0, batch });
  };

  private readonly drawSlider = (slider: OsuSlider, _path: OsuSliderPath, alpha: number,
    color: readonly [number, number, number, number]): void => {
    const commands = this.active_commands;
    const viewport = this.active_viewport;
    const frame = this.active_frame;
    if (!commands || !viewport || !frame) return;
    this.graphics.submit(commands);
    commands.length = 0;
    this.slider_draw_calls += this.slider_graphics.draw(slider, viewport, frame,
      this.skin.sliderTrackOverride ?? color, this.skin.sliderBorderColor, alpha);
  };

  destroy(): void {
    this.slider_graphics.destroy();
    this.graphics.destroy();
  }

  private readonly writeHudCommand = (x: number, y: number, width: number, height: number,
    color: readonly [number, number, number, number], sprite: SpriteDrawCommand["sprite"],
    flip_y?: boolean, batch?: string, rotate_ccw?: boolean, rotation_radians?: number, circular_progress?: number) => {
    this.active_commands?.push({ x, y, width, height, color, sprite, flipY: flip_y ?? false,
      rotateCounterClockwise: rotate_ccw ?? false, rotationRadians: rotation_radians ?? 0,
      circularProgress: circular_progress, batch });
  };
}
