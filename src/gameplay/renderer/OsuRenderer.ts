import type { OsuChart } from "../../chart/Chart";
import { OsuPlayfieldRenderer } from "./OsuPlayfieldRenderer";
import type { OsuStandardSkin } from "./OsuSkin";
import type { SpriteDrawCommand } from "./Sprite";
import { WebGlSpriteGraphics } from "./WebGlSpriteGraphics";

export class OsuRenderer {
  // Osu-specific GPU resources, including future slider mesh caches, belong to this renderer and its destroy boundary.
  private readonly playfield: OsuPlayfieldRenderer;
  private readonly graphics: WebGlSpriteGraphics;

  constructor(canvas: HTMLCanvasElement, skin: OsuStandardSkin) {
    this.playfield = new OsuPlayfieldRenderer(skin);
    this.graphics = new WebGlSpriteGraphics(canvas, skin);
  }

  draw(chart: OsuChart, song_time: number): void {
    const frame = this.graphics.getFrame();
    this.graphics.beginFrame(frame);
    const commands: SpriteDrawCommand[] = [];
    this.playfield.draw(this.playfield.getLayout(frame.logical_width, frame.logical_height), chart, song_time,
      (x, y, width, height, color, sprite) => {
        commands.push({ x, y, width, height, color, sprite, flipY: false, rotateCounterClockwise: false });
      });
    this.graphics.submit(commands);
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
