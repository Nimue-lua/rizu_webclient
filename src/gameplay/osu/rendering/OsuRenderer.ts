import type { OsuChart } from "../../../chart/Chart";
import type { GameplayPresentationState } from "../../HudState";
import { getGameplayHudLayout, type GameplayHudRenderer } from "../../GameplayHudRenderer";
import { SpriteGameplayHudRenderer } from "../../renderer/GameplayHudRenderer";
import { OsuComboRenderer } from "./OsuComboRenderer";
import { OsuPlayfieldRenderer } from "./OsuPlayfieldRenderer";
import type { OsuStandardSkin } from "../../renderer/OsuSkin";
import type { SpriteDrawCommand } from "../../renderer/Sprite";
import { WebGlSpriteGraphics } from "../../renderer/WebGlSpriteGraphics";
import { OsuViewport, type ClientBounds, type Point } from "../OsuViewport";
import type { OsuCursorState } from "../OsuInputEvent";
import type { OsuCircleTransient } from "../OsuCirclePresentation";
import type { OsuSlider } from "../../../chart/Chart";
import { OsuSliderPath } from "../OsuSliderPath";
import { osuCircleDiameter } from "../OsuCircleGeometry";
import { WebGlSliderGraphics, type OsuSliderRendererMode } from "./WebGlSliderGraphics";
import type { OsuSliderPresentationState, OsuSpinnerPresentationState } from "../OsuSliderPresentation";

const MAX_SLIDER_UPLOADS_PER_FRAME = 2;

export interface OsuGameplayRenderer {
  clientToPlayfield(point: Point, bounds: ClientBounds): Point;
  draw(chart: OsuChart, circle_states: Uint8Array, first_active_index: number,
    circle_transients: readonly OsuCircleTransient[], song_time: number,
    state: GameplayPresentationState, cursor: OsuCursorState,
    slider_states?: readonly OsuSliderPresentationState[], spinner_state?: OsuSpinnerPresentationState | null): void;
  destroy(): void;
}

export class OsuRenderer implements OsuGameplayRenderer {
  // Osu-specific GPU resources, including future slider mesh caches, belong to this renderer and its destroy boundary.
  private readonly playfield: OsuPlayfieldRenderer;
  private readonly combo: OsuComboRenderer;
  private readonly graphics: WebGlSpriteGraphics;
  private readonly slider_graphics: WebGlSliderGraphics;
  private readonly hud: GameplayHudRenderer;
  private active_commands: SpriteDrawCommand[] | null = null;
  private readonly skin: OsuStandardSkin;
  private readonly x_flip: boolean;
  private readonly y_flip: boolean;
  private readonly cursor_scale: number;
  private readonly slider_paths = new Map<OsuSlider, OsuSliderPath>();
  private readonly rejected_slider_paths = new WeakSet<OsuSlider>();

  constructor(canvas: HTMLCanvasElement, skin: OsuStandardSkin, hud?: GameplayHudRenderer,
    x_flip = false, y_flip = false, cursor_scale = 1, slider_renderer: OsuSliderRendererMode = "direct") {
    this.skin = skin;
    this.x_flip = x_flip;
    this.y_flip = y_flip;
    this.cursor_scale = cursor_scale;
    this.playfield = new OsuPlayfieldRenderer(skin);
    this.combo = new OsuComboRenderer(skin);
    this.graphics = new WebGlSpriteGraphics(canvas, skin);
    this.slider_graphics = new WebGlSliderGraphics(canvas, slider_renderer);
    this.hud = hud ?? new SpriteGameplayHudRenderer(skin, this.writeHudCommand);
  }

  clientToPlayfield(point: Point, bounds: ClientBounds): Point {
    const frame = this.graphics.getFrame();
    return this.createViewport(frame.logical_width, frame.logical_height).clientToPlayfield(point, bounds);
  }

  draw(chart: OsuChart, circle_states: Uint8Array, first_active_index: number,
    circle_transients: readonly OsuCircleTransient[], song_time: number,
    state: GameplayPresentationState, cursor: OsuCursorState,
    slider_states: readonly OsuSliderPresentationState[] | undefined = undefined,
    spinner_state: OsuSpinnerPresentationState | null = null): void {
    const frame = this.graphics.getFrame();
    this.graphics.beginFrame(frame);
    const commands: SpriteDrawCommand[] = [];
    this.active_commands = commands;
    const write = (x: number, y: number, width: number, height: number,
      color: readonly [number, number, number, number], sprite: SpriteDrawCommand["sprite"],
      flip_y?: boolean, batch?: string, rotate_ccw?: boolean, rotation_radians?: number) => {
      commands.push({ x, y, width, height, color, sprite, flipY: flip_y ?? false,
        rotateCounterClockwise: rotate_ccw ?? false, rotationRadians: rotation_radians ?? 0, batch });
    };
    const viewport = this.createViewport(frame.logical_width, frame.logical_height);
    let uploads = 0;
    const sliderPath = (slider: OsuSlider) => {
      let path = this.slider_paths.get(slider);
      if (!path && !this.rejected_slider_paths.has(slider) && uploads < MAX_SLIDER_UPLOADS_PER_FRAME) {
        path = OsuSliderPath.create(slider, chart.format_version);
        if (this.slider_graphics.upload(slider, path, osuCircleDiameter(chart.circle_size) / 2)) {
          this.slider_paths.set(slider, path);
        } else {
          this.rejected_slider_paths.add(slider);
          path = undefined;
        }
        uploads += 1;
      }
      return path;
    };
    this.hud.drawHpBar();
    this.playfield.draw(viewport, chart, circle_states, first_active_index, circle_transients, song_time, write,
      sliderPath, (slider, _path, alpha, color) => {
        this.graphics.submit(commands);
        commands.length = 0;
        this.slider_graphics.draw(slider, viewport, frame,
          this.skin.sliderTrackOverride ?? color, this.skin.sliderBorderColor, alpha);
      }, slider_states, spinner_state);
    this.combo.draw(state.combo, state.comboAnimationAge, state.comboAnimationFrom,
      8, frame.logical_height - 8, write);
    this.hud.drawScore(state.hud, getGameplayHudLayout(frame.logical_width));
    const cursor_center = viewport.playfieldToScreen(cursor.position);
    const cursor_scale = this.cursor_scale * (cursor.primary || cursor.secondary ? 0.9 : 1);
    const cursor_width = this.skin.cursor.sourceSize.w * viewport.scale * cursor_scale;
    const cursor_height = this.skin.cursor.sourceSize.h * viewport.scale * cursor_scale;
    write(cursor_center.x - cursor_width / 2, cursor_center.y - cursor_height / 2,
      cursor_width, cursor_height, [1, 1, 1, 1], this.skin.cursor);
    this.active_commands = null;
    this.graphics.submit(commands);
  }

  private createViewport(width: number, height: number): OsuViewport {
    return new OsuViewport(width, height, this.x_flip, this.y_flip);
  }

  destroy(): void {
    this.slider_graphics.destroy();
    this.graphics.destroy();
  }

  private readonly writeHudCommand = (x: number, y: number, width: number, height: number,
    color: readonly [number, number, number, number], sprite: SpriteDrawCommand["sprite"]) => {
    this.active_commands?.push({ x, y, width, height, color, sprite, flipY: false,
      rotateCounterClockwise: false, rotationRadians: 0 });
  };
}
