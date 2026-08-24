import type { ManiaVisualNote } from "../ManiaRulesEngine";
import { ManiaPlayfieldRenderer, type ManiaHudState } from "./ManiaPlayfieldRenderer";
import type { NoteSkin } from "./NoteSkin";
import type { SpriteDrawCommand } from "./Sprite";
import { WebGlSpriteGraphics } from "./WebGlSpriteGraphics";

export class ManiaRenderer {
  private readonly playfield: ManiaPlayfieldRenderer;
  private readonly graphics: WebGlSpriteGraphics;

  constructor(canvas: HTMLCanvasElement, private readonly skin: NoteSkin) {
    this.playfield = new ManiaPlayfieldRenderer(skin);
    this.graphics = new WebGlSpriteGraphics(canvas, skin);
  }

  getTimeRange(column_count: number, scroll_speed: number): { past: number; future: number } {
    this.validateColumnCount(column_count);
    const frame = this.graphics.getFrame();
    return this.playfield.getTimeRange(this.playfield.getLayout(frame.logical_width), scroll_speed);
  }

  draw(column_count: number, notes: readonly ManiaVisualNote[], scroll_speed: number,
    pressed_columns: ArrayLike<number> = [], hud?: ManiaHudState): void {
    this.validateColumnCount(column_count);
    const frame = this.graphics.getFrame();
    const layout = this.playfield.getLayout(frame.logical_width);
    this.graphics.beginFrame(frame);
    const commands: SpriteDrawCommand[] = [];
    this.playfield.draw(layout, notes, scroll_speed, pressed_columns,
      (x, y, width, height, color, sprite, flip_y, batch, rotate_ccw) => {
        commands.push({ x, y, width, height, color, sprite, flipY: flip_y ?? false,
          rotateCounterClockwise: rotate_ccw ?? false, batch });
      }, hud);
    this.graphics.submit(commands);
  }

  destroy(): void {
    this.graphics.destroy();
  }

  private validateColumnCount(column_count: number): void {
    if (column_count !== this.skin.config.columnCount) throw new Error("Chart and skin column counts do not match");
  }
}
