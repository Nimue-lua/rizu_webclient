import { NoteState, type VisualNote } from "../RhythmEngine";
import { NOTE_SKIN_LOGICAL_HEIGHT, type NoteSkin, type NoteSkinSprite } from "./NoteSkin";

export interface ManiaLayout {
  readonly width: number;
  readonly height: number;
  readonly columnLeft: readonly number[];
  readonly columnWidth: readonly number[];
  readonly receptorY: number;
}

export type NoteRenderPass = "long-note-bodies" | "long-note-tails" | "long-note-heads" | "short-notes";
export interface ManiaHudState {
  combo: number;
  accuracy: number;
  judgment: string | null;
  judgmentAge: number;
}
export type QuadWriter = (x: number, y: number, width: number, height: number,
  color: readonly [number, number, number, number], sprite: NoteSkinSprite, flip_y?: boolean,
  pass?: NoteRenderPass, rotate_ccw?: boolean) => void;

export function getLongNoteBrightness(state: NoteState): number {
  if (state === NoteState.StartMissedPressed) return 0.75;
  if (state === NoteState.StartMissed || state === NoteState.EndMissed || state === NoteState.EndMissedPassed) return 0.5;
  return 1;
}

export class ManiaPlayfieldRenderer {
  constructor(private readonly skin: NoteSkin) {}

  get comboPosition(): number { return this.skin.config.comboPosition; }
  get judgePosition(): number { return this.skin.config.judgePosition; }

  getLayout(viewport_width: number): ManiaLayout {
    const config = this.skin.config;
    const natural_width = config.columnWidths.reduce((sum, value) => sum + value, 0) +
      config.columnSpacing.reduce((sum, value) => sum + value, 0);
    const scale = Math.min(1, viewport_width / natural_width);
    const columnWidth = config.columnWidths.map((value) => value * scale);
    const columnLeft: number[] = [];
    const authored_left = config.columnStart * scale;
    let x = Math.max(0, Math.min(authored_left, viewport_width - natural_width * scale));
    for (let column = 0; column < config.columnCount; column += 1) {
      columnLeft.push(x);
      x += columnWidth[column]! + (config.columnSpacing[column] ?? 0) * scale;
    }
    const receptorY = config.upsideDown ? NOTE_SKIN_LOGICAL_HEIGHT - config.hitPosition : config.hitPosition;
    return { width: viewport_width, height: NOTE_SKIN_LOGICAL_HEIGHT, columnLeft, columnWidth, receptorY };
  }

  getTimeRange(layout: ManiaLayout, scroll_speed: number): { past: number; future: number } {
    const seconds_per_pixel = 1 / (NOTE_SKIN_LOGICAL_HEIGHT * scroll_speed);
    const margin = Math.max(...layout.columnWidth);
    if (this.skin.config.upsideDown) {
      return {
        future: (layout.height + margin - layout.receptorY) * seconds_per_pixel,
        past: (layout.receptorY + margin) * seconds_per_pixel,
      };
    }
    return {
      future: (layout.receptorY + margin) * seconds_per_pixel,
      past: (layout.height + margin - layout.receptorY) * seconds_per_pixel,
    };
  }

  draw(layout: ManiaLayout, notes: readonly VisualNote[], scroll_speed: number,
    pressed_columns: ArrayLike<number>, write: QuadWriter, hud?: ManiaHudState): void {
    const speed = NOTE_SKIN_LOGICAL_HEIGHT * scroll_speed;
    const config = this.skin.config;
    this.addStageSides(layout, write);
    this.addHpBar(layout, write);
    this.addColumnLines(layout, write);
    this.addStageHint(layout, write);
    for (let column = 0; column < config.columnCount; column += 1) {
      const receptors = pressed_columns[column] ? config.receptorPressed : config.receptorReleased;
      this.addReceptor(receptors[column], column, layout, write);
    }
    for (const note of notes) {
      if (note.end_dt === undefined) continue;
      const column = note.column - 1;
      const direction = config.upsideDown ? 1 : -1;
      const head_y = layout.receptorY + note.start_dt * speed * direction;
      const tail_y = layout.receptorY + note.end_dt * speed * direction;
      const head_height = this.getSpriteHeight(config.longNoteHeads[column], column, layout);
      const body_head_y = head_y + direction * head_height * 0.5;
      const body_top = Math.min(body_head_y, tail_y);
      this.addSprite(config.longNoteBodies[column], column, layout, body_top, write,
        Math.abs(body_head_y - tail_y), getLongNoteBrightness(note.state), true, 0,
        config.longNoteBodyFlipY[column], "long-note-bodies");
    }
    for (const note of notes) {
      if (note.end_dt === undefined) continue;
      const column = note.column - 1;
      const direction = config.upsideDown ? 1 : -1;
      const tail_y = layout.receptorY + note.end_dt * speed * direction;
      this.addSprite(config.longNoteTails[column], column, layout, tail_y, write,
        undefined, getLongNoteBrightness(note.state), false, config.upsideDown ? 0 : 1,
        config.longNoteTailFlipY[column], "long-note-tails");
    }
    for (const note of notes) {
      if (note.end_dt === undefined) continue;
      const column = note.column - 1;
      const direction = config.upsideDown ? 1 : -1;
      const head_y = layout.receptorY + note.start_dt * speed * direction;
      this.addSprite(config.longNoteHeads[column], column, layout, head_y, write,
        undefined, getLongNoteBrightness(note.state), false, config.upsideDown ? 0 : 1,
        config.longNoteHeadFlipY[column], "long-note-heads");
    }
    for (const note of notes) {
      if (note.end_dt !== undefined) continue;
      const column = note.column - 1;
      const y = layout.receptorY + note.start_dt * speed * (config.upsideDown ? 1 : -1);
      this.addSprite(config.shortNotes[column], column, layout, y,
        write, undefined, 1, false, config.upsideDown ? 0 : 1,
        config.shortNoteFlipY[column], "short-notes");
    }
    this.addStageBottom(layout, write);
    if (hud) this.addHud(layout, hud, write);
  }

  private addColumnLines(layout: ManiaLayout, write: QuadWriter): void {
    const sprite = this.skin.sprites.__white;
    if (!sprite) return;
    const config = this.skin.config;
    const line_top = config.upsideDown ? layout.receptorY : 0;
    const line_height = config.hitPosition;
    for (let column = 0; column < config.columnCount; column += 1) {
      const left_width = config.columnLineWidths[column] ?? 2;
      if (left_width > 0) write(layout.columnLeft[column]!, line_top, left_width * 0.4625, line_height,
        config.columnLineColor, sprite);
    }
    const right_width = config.columnLineWidths[config.columnCount] ?? 2;
    if (right_width > 0) {
      const right = layout.columnLeft.at(-1)! + layout.columnWidth.at(-1)! - 0.1;
      write(right, line_top, right_width * 0.4625, line_height, config.columnLineColor, sprite);
    }
  }

  private addHpBar(layout: ManiaLayout, write: QuadWriter): void {
    const config = this.skin.config;
    const right = layout.columnLeft.at(-1)! + layout.columnWidth.at(-1)!;
    const add = (name: string | undefined, x: number, bottom: number) => {
      const sprite = name ? this.skin.sprites[name] : undefined;
      if (!sprite) return;
      const width = sprite.sourceSize.h * 0.4375;
      const height = sprite.sourceSize.w * 0.4375;
      write(x, bottom - height, width, height, [1, 1, 1, 1], sprite, false, undefined, true);
    };
    add(config.hpBackground, right + 1, NOTE_SKIN_LOGICAL_HEIGHT);
    add(config.hpFill, right + 6.6, 474.8);
  }

  private addHud(layout: ManiaLayout, hud: ManiaHudState, write: QuadWriter): void {
    const config = this.skin.config;
    const left = layout.columnLeft[0]!;
    const right = layout.columnLeft.at(-1)! + layout.columnWidth.at(-1)!;
    const center = (left + right) * 0.5;
    if (hud.judgment && hud.judgmentAge < 0.22) {
      const frames = config.judgments[hud.judgment] ?? [];
      const name = frames[Math.min(frames.length - 1, Math.floor(hud.judgmentAge * 20))];
      const sprite = name ? this.skin.sprites[name] : undefined;
      if (sprite) {
        const scale = 0.625;
        const width = sprite.sourceSize.w * scale;
        const height = sprite.sourceSize.h * scale;
        const alpha = hud.judgmentAge <= 0.18 ? 1 : (0.22 - hud.judgmentAge) / 0.04;
        const y = config.upsideDown ? NOTE_SKIN_LOGICAL_HEIGHT - config.judgePosition : config.judgePosition;
        write(center - width * 0.5, y - height * 0.5, width, height, [1, 1, 1, alpha], sprite);
      }
    }
    if (hud.combo > 0) this.addBitmapText(String(hud.combo), config.comboGlyphs, config.comboOverlap,
      center, config.upsideDown ? NOTE_SKIN_LOGICAL_HEIGHT - config.comboPosition : config.comboPosition,
      1, "center", write);
    const score_height = this.bitmapTextHeight(config.scoreGlyphs) * 0.625 * 0.96;
    this.addBitmapText("0000000", config.scoreGlyphs, config.scoreOverlap, layout.width - 6, 0, 0.96, "right", write);
    this.addBitmapText(`${hud.accuracy.toFixed(2).padStart(5, "0")}%`, config.scoreGlyphs,
      config.scoreOverlap, layout.width - 6, score_height + 3, 0.576, "right", write);
  }

  private addBitmapText(text: string, glyphs: Readonly<Record<string, string>>, overlap: number,
    anchor_x: number, y: number, scale: number, align: "center" | "right", write: QuadWriter): void {
    const constant_width = this.skin.sprites[glyphs["5"] ?? ""]?.sourceSize.w ?? 40;
    const placements: { sprite: NoteSkinSprite; x: number }[] = [];
    let x = 0;
    for (const character of text) {
      const sprite = this.skin.sprites[glyphs[character] ?? ""];
      if (!sprite) continue;
      const standard = character >= "0" && character <= "9";
      placements.push({ sprite, x: x + (standard ? Math.max(0, (constant_width - sprite.sourceSize.w) * 0.5) : 0) });
      x += (standard ? constant_width : sprite.sourceSize.w) - overlap;
    }
    const logical_scale = 0.625 * scale;
    const left = anchor_x - x * logical_scale * (align === "center" ? 0.5 : 1);
    for (const placement of placements) {
      write(left + placement.x * logical_scale, y, placement.sprite.sourceSize.w * logical_scale,
        placement.sprite.sourceSize.h * logical_scale, [1, 1, 1, 1], placement.sprite);
    }
  }

  private bitmapTextHeight(glyphs: Readonly<Record<string, string>>): number {
    return this.skin.sprites[glyphs["0"] ?? ""]?.sourceSize.h ?? 0;
  }

  private addStageSides(layout: ManiaLayout, write: QuadWriter): void {
    const left = layout.columnLeft[0]!;
    const right = layout.columnLeft.at(-1)! + layout.columnWidth.at(-1)!;
    const addSide = (name: string | undefined, x: number, left_origin: boolean) => {
      const sprite = name ? this.skin.sprites[name] : undefined;
      if (!sprite) return;
      const width = sprite.sourceSize.w * NOTE_SKIN_LOGICAL_HEIGHT / 768;
      write(left_origin ? x - width : x, 0, width, NOTE_SKIN_LOGICAL_HEIGHT, [1, 1, 1, 1], sprite);
    };
    addSide(this.skin.config.stageLeft, left, true);
    addSide(this.skin.config.stageRight, right, false);
  }

  private addStageHint(layout: ManiaLayout, write: QuadWriter): void {
    const name = this.skin.config.stageHint;
    const sprite = name ? this.skin.sprites[name] : undefined;
    if (!sprite) return;
    const left = layout.columnLeft[0]!;
    const right = layout.columnLeft.at(-1)! + layout.columnWidth.at(-1)!;
    const height = sprite.sourceSize.h * 0.9;
    write(left, layout.receptorY - height * 0.5, right - left, height, [1, 1, 1, 0.9], sprite,
      this.skin.config.upsideDown);
  }

  private addStageBottom(layout: ManiaLayout, write: QuadWriter): void {
    const name = this.skin.config.stageBottom;
    const sprite = name ? this.skin.sprites[name] : undefined;
    if (!sprite) return;
    const left = layout.columnLeft[0]!;
    const right = layout.columnLeft.at(-1)! + layout.columnWidth.at(-1)!;
    const x = (left + right - sprite.sourceSize.w) * 0.5;
    const y = this.skin.config.upsideDown ? 0 : NOTE_SKIN_LOGICAL_HEIGHT - sprite.sourceSize.h;
    write(x, y, sprite.sourceSize.w, sprite.sourceSize.h, [1, 1, 1, 1], sprite);
  }

  private addReceptor(name: string, column: number, layout: ManiaLayout, write: QuadWriter): void {
    const sprite = this.skin.sprites[name];
    if (!sprite) return;
    const width = layout.columnWidth[column]!;
    const height = sprite.sourceSize.h * NOTE_SKIN_LOGICAL_HEIGHT / 768;
    const top = this.skin.config.upsideDown ? 0 : NOTE_SKIN_LOGICAL_HEIGHT - height;
    write(layout.columnLeft[column]!, top, width, height, [1, 1, 1, 1], sprite,
      this.skin.config.receptorFlipY[column]);
  }

  private addSprite(name: string, column: number, layout: ManiaLayout, y: number, write: QuadWriter,
    height?: number, brightness = 1, stretch = false, origin_y = 0, flip_y = false,
    pass?: NoteRenderPass): void {
    const sprite = this.skin.sprites[name];
    if (!sprite) return;
    const scale = layout.columnWidth[column]! / sprite.sourceSize.w;
    const draw_height = height ?? sprite.sourceSize.h * scale;
    if (draw_height <= 0) return;
    const x = layout.columnLeft[column]!;
    const top = stretch ? y : y - sprite.sourceSize.h * scale * origin_y;
    write(x, top, layout.columnWidth[column]!, stretch ? draw_height : sprite.sourceSize.h * scale,
      [brightness, brightness, brightness, 1], sprite, flip_y, pass);
  }

  private getSpriteHeight(name: string, column: number, layout: ManiaLayout): number {
    const sprite = this.skin.sprites[name];
    return sprite ? sprite.sourceSize.h * layout.columnWidth[column]! / sprite.sourceSize.w : 0;
  }

}
