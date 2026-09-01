import type { ManiaVisualNote } from "../ManiaRulesEngine";
import type { GameplayPresentationState } from "../../HudState";
import { getGameplayHudLayout, type GameplayHudRenderer } from "../../GameplayHudRenderer";
import { SpriteGameplayHudRenderer } from "../../renderer/GameplayHudRenderer";
import { ManiaOverlayRenderer } from "./ManiaOverlayRenderer";
import { ManiaPlayfieldRenderer } from "./ManiaPlayfieldRenderer";
import type { NoteSkin } from "../../../noteskin/NoteSkin";
import type { SpriteDrawCommand } from "../../renderer/Sprite";
import { WebGlSpriteGraphics } from "../../renderer/WebGlSpriteGraphics";
import type { GameplayRenderStats } from "../../renderer/GameplayRenderStats";
import type { HitErrorMeterOptions } from "../../renderer/GameplayHudRenderer";

export class ManiaRenderer {
  private readonly playfield: ManiaPlayfieldRenderer;
  private readonly overlay: ManiaOverlayRenderer;
  private readonly graphics: WebGlSpriteGraphics;
  private readonly hud: GameplayHudRenderer;
  private active_commands: SpriteDrawCommand[] | null = null;

  constructor(canvas: HTMLCanvasElement, private readonly skin: NoteSkin, hud?: GameplayHudRenderer,
    hit_error_options?: HitErrorMeterOptions) {
    this.playfield = new ManiaPlayfieldRenderer(skin);
    this.overlay = new ManiaOverlayRenderer({ sprites: skin.sprites, judgments: skin.config.judgments,
      comboGlyphs: skin.config.comboGlyphs, comboOverlap: skin.config.comboOverlap });
    this.graphics = new WebGlSpriteGraphics(canvas, skin);
    this.hud = hud ?? new SpriteGameplayHudRenderer({ sprites: skin.sprites,
      scoreGlyphs: skin.config.scoreGlyphs, scoreOverlap: skin.config.scoreOverlap,
      progressOverlay: skin.sprites.circularmetre, progressFill: skin.sprites.__white,
      hitErrorFill: skin.sprites.__white, hitErrorArrow: skin.sprites["editor-rate-arrow"] }, this.writeHudCommand,
      hit_error_options);
  }

  getTimeRange(column_count: number, scroll_speed: number): { past: number; future: number } {
    this.validateColumnCount(column_count);
    const frame = this.graphics.getFrame();
    return this.playfield.getTimeRange(this.playfield.getLayout(frame.logical_width), scroll_speed);
  }

  draw(column_count: number, notes: readonly ManiaVisualNote[], scroll_speed: number,
    pressed_columns: ArrayLike<number> = [], state: GameplayPresentationState,
    progress: number | null = null): GameplayRenderStats {
    this.validateColumnCount(column_count);
    const frame = this.graphics.getFrame();
    const layout = this.playfield.getLayout(frame.logical_width);
    this.graphics.beginFrame(frame);
    const commands: SpriteDrawCommand[] = [];
    this.active_commands = commands;
    const write = (x: number, y: number, width: number, height: number,
      color: readonly [number, number, number, number], sprite: SpriteDrawCommand["sprite"],
      flip_y?: boolean, batch?: string, rotate_ccw?: boolean, rotation_radians?: number) => {
      commands.push({ x, y, width, height, color, sprite, flipY: flip_y ?? false,
        rotateCounterClockwise: rotate_ccw ?? false, rotationRadians: rotation_radians ?? 0, batch });
    };
    this.playfield.draw(layout, notes, scroll_speed, pressed_columns, write);
    const left = layout.columnLeft[0]!;
    const right = layout.columnLeft.at(-1)! + layout.columnWidth.at(-1)!;
    const center = (left + right) * 0.5;
    this.overlay.draw({ centerX: center,
      comboTop: this.skin.config.upsideDown ? layout.height - this.skin.config.comboPosition : this.skin.config.comboPosition,
      judgmentCenterY: this.skin.config.upsideDown ? layout.height - this.skin.config.judgePosition : this.skin.config.judgePosition,
    }, state, write);
    this.hud.drawScore(state.hud, getGameplayHudLayout(layout.width));
    this.hud.drawProgress(progress, getGameplayHudLayout(layout.width));
    this.hud.drawHitErrorMeter(state.hitErrorMeter, getGameplayHudLayout(layout.width));
    this.active_commands = null;
    this.graphics.submit(commands);
    return {
      draw_calls: this.graphics.drawCallCount,
      command_count: this.graphics.commandCount,
      vertex_count: this.graphics.vertexCount,
      buffer_upload_count: this.graphics.bufferUploadCount,
      slider_pass_count: 0,
    };
  }

  destroy(): void {
    this.graphics.destroy();
  }

  private validateColumnCount(column_count: number): void {
    if (column_count !== this.skin.config.columnCount) throw new Error("Chart and skin column counts do not match");
  }

  private readonly writeHudCommand = (x: number, y: number, width: number, height: number,
    color: readonly [number, number, number, number], sprite: SpriteDrawCommand["sprite"],
    flip_y?: boolean, batch?: string, rotate_ccw?: boolean, rotation_radians?: number, circular_progress?: number,
    additive?: boolean) => {
    this.active_commands?.push({ x, y, width, height, color, sprite, flipY: flip_y ?? false,
      rotateCounterClockwise: rotate_ccw ?? false, rotationRadians: rotation_radians ?? 0,
      circularProgress: circular_progress, additive, batch });
  };
}
