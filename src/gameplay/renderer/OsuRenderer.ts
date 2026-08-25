import type { OsuChart } from "../../chart/Chart";
import type { GameplayPresentationState } from "../HudState";
import { getGameplayHudLayout, type GameplayHudRenderer } from "../GameplayHudRenderer";
import { SpriteGameplayHudRenderer } from "./GameplayHudRenderer";
import { OsuComboRenderer } from "./OsuComboRenderer";
import { OsuPlayfieldRenderer } from "./OsuPlayfieldRenderer";
import type { OsuStandardSkin } from "./OsuSkin";
import type { SpriteDrawCommand } from "./Sprite";
import { WebGlSpriteGraphics } from "./WebGlSpriteGraphics";
import { OsuViewport, type ClientBounds, type Point } from "../OsuViewport";
import type { OsuCursorState } from "../OsuInputEvent";
import type { OsuCircleTransient } from "../OsuCirclePresentation";

export interface OsuGameplayRenderer {
  clientToPlayfield(point: Point, bounds: ClientBounds): Point;
  draw(chart: OsuChart, circle_states: Uint8Array, first_active_index: number,
    circle_transients: readonly OsuCircleTransient[], song_time: number,
    state: GameplayPresentationState, cursor: OsuCursorState): void;
  destroy(): void;
}

export class OsuRenderer implements OsuGameplayRenderer {
  // Osu-specific GPU resources, including future slider mesh caches, belong to this renderer and its destroy boundary.
  private readonly playfield: OsuPlayfieldRenderer;
  private readonly combo: OsuComboRenderer;
  private readonly graphics: WebGlSpriteGraphics;
  private readonly hud: GameplayHudRenderer;
  private active_commands: SpriteDrawCommand[] | null = null;
  private readonly skin: OsuStandardSkin;
  private readonly x_flip: boolean;
  private readonly y_flip: boolean;

  constructor(canvas: HTMLCanvasElement, skin: OsuStandardSkin, hud?: GameplayHudRenderer,
    x_flip = false, y_flip = false) {
    this.skin = skin;
    this.x_flip = x_flip;
    this.y_flip = y_flip;
    this.playfield = new OsuPlayfieldRenderer(skin);
    this.combo = new OsuComboRenderer(skin);
    this.graphics = new WebGlSpriteGraphics(canvas, skin);
    this.hud = hud ?? new SpriteGameplayHudRenderer(skin, this.writeHudCommand);
  }

  clientToPlayfield(point: Point, bounds: ClientBounds): Point {
    const frame = this.graphics.getFrame();
    return this.createViewport(frame.logical_width, frame.logical_height).clientToPlayfield(point, bounds);
  }

  draw(chart: OsuChart, circle_states: Uint8Array, first_active_index: number,
    circle_transients: readonly OsuCircleTransient[], song_time: number,
    state: GameplayPresentationState, cursor: OsuCursorState): void {
    const frame = this.graphics.getFrame();
    this.graphics.beginFrame(frame);
    const commands: SpriteDrawCommand[] = [];
    this.active_commands = commands;
    const write = (x: number, y: number, width: number, height: number,
      color: readonly [number, number, number, number], sprite: SpriteDrawCommand["sprite"]) => {
      commands.push({ x, y, width, height, color, sprite, flipY: false, rotateCounterClockwise: false });
    };
    const viewport = this.createViewport(frame.logical_width, frame.logical_height);
    this.playfield.draw(viewport, chart, circle_states, first_active_index, circle_transients, song_time, write);
    this.combo.draw(state.combo, viewport.stage_left + 8 * viewport.scale,
      viewport.stage_top + 472 * viewport.scale, write);
    const cursor_center = viewport.playfieldToScreen(cursor.position);
    const cursor_scale = cursor.primary || cursor.secondary ? 0.9 : 1;
    const cursor_width = this.skin.cursor.sourceSize.w * viewport.scale * cursor_scale;
    const cursor_height = this.skin.cursor.sourceSize.h * viewport.scale * cursor_scale;
    write(cursor_center.x - cursor_width / 2, cursor_center.y - cursor_height / 2,
      cursor_width, cursor_height, [1, 1, 1, 1], this.skin.cursor);
    this.hud.draw(state.hud, getGameplayHudLayout(frame.logical_width));
    this.active_commands = null;
    this.graphics.submit(commands);
  }

  private createViewport(width: number, height: number): OsuViewport {
    return new OsuViewport(width, height, this.x_flip, this.y_flip);
  }

  destroy(): void {
    this.graphics.destroy();
  }

  private readonly writeHudCommand = (x: number, y: number, width: number, height: number,
    color: readonly [number, number, number, number], sprite: SpriteDrawCommand["sprite"]) => {
    this.active_commands?.push({ x, y, width, height, color, sprite, flipY: false, rotateCounterClockwise: false });
  };
}
