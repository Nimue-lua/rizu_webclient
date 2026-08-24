import type { OsuChart } from "../../chart/Chart";
import type { GameplayPresentationState } from "../HudState";
import { getGameplayHudLayout, type GameplayHudRenderer } from "../GameplayHudRenderer";
import { SpriteGameplayHudRenderer } from "./GameplayHudRenderer";
import { OsuComboRenderer } from "./OsuComboRenderer";
import { OsuPlayfieldRenderer } from "./OsuPlayfieldRenderer";
import type { OsuStandardSkin } from "./OsuSkin";
import type { SpriteDrawCommand } from "./Sprite";
import { WebGlSpriteGraphics } from "./WebGlSpriteGraphics";

export class OsuRenderer {
  // Osu-specific GPU resources, including future slider mesh caches, belong to this renderer and its destroy boundary.
  private readonly playfield: OsuPlayfieldRenderer;
  private readonly combo: OsuComboRenderer;
  private readonly graphics: WebGlSpriteGraphics;
  private readonly hud: GameplayHudRenderer;
  private active_commands: SpriteDrawCommand[] | null = null;

  constructor(canvas: HTMLCanvasElement, skin: OsuStandardSkin, hud?: GameplayHudRenderer) {
    this.playfield = new OsuPlayfieldRenderer(skin);
    this.combo = new OsuComboRenderer(skin);
    this.graphics = new WebGlSpriteGraphics(canvas, skin);
    this.hud = hud ?? new SpriteGameplayHudRenderer(skin, this.writeHudCommand);
  }

  draw(chart: OsuChart, song_time: number, state: GameplayPresentationState): void {
    const frame = this.graphics.getFrame();
    this.graphics.beginFrame(frame);
    const commands: SpriteDrawCommand[] = [];
    this.active_commands = commands;
    const write = (x: number, y: number, width: number, height: number,
      color: readonly [number, number, number, number], sprite: SpriteDrawCommand["sprite"]) => {
      commands.push({ x, y, width, height, color, sprite, flipY: false, rotateCounterClockwise: false });
    };
    const layout = this.playfield.getLayout(frame.logical_width, frame.logical_height);
    this.playfield.draw(layout, chart, song_time, write);
    this.combo.draw(state.combo, layout.left + 8 * layout.scale, layout.top + 472 * layout.scale, write);
    this.hud.draw(state.hud, getGameplayHudLayout(frame.logical_width));
    this.active_commands = null;
    this.graphics.submit(commands);
  }

  destroy(): void {
    this.graphics.destroy();
  }

  private readonly writeHudCommand = (x: number, y: number, width: number, height: number,
    color: readonly [number, number, number, number], sprite: SpriteDrawCommand["sprite"]) => {
    this.active_commands?.push({ x, y, width, height, color, sprite, flipY: false, rotateCounterClockwise: false });
  };
}
