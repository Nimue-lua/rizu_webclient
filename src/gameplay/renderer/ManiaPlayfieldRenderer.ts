import { NoteState, type VisualNote } from "../RhythmEngine";
import { NOTE_SKIN_LOGICAL_HEIGHT, type NoteSkin, type NoteSkinFrame } from "./NoteSkin";

export interface ManiaLayout {
  readonly width: number;
  readonly height: number;
  readonly columnLeft: readonly number[];
  readonly columnWidth: readonly number[];
  readonly receptorY: number;
}

export type QuadWriter = (x: number, y: number, width: number, height: number,
  color: readonly [number, number, number, number], frame: NoteSkinFrame, flip_y?: boolean) => void;

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
    pressed_columns: ArrayLike<number>, write: QuadWriter): void {
    const speed = NOTE_SKIN_LOGICAL_HEIGHT * scroll_speed;
    const config = this.skin.config;
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
        Math.abs(body_head_y - tail_y), getLongNoteBrightness(note.state), true, 0, config.longNoteBodyFlipY[column]);
      this.addSprite(config.longNoteTails[column], column, layout, tail_y, write,
        undefined, getLongNoteBrightness(note.state), false, config.upsideDown ? 0 : 1, config.longNoteTailFlipY[column]);
      this.addSprite(config.longNoteHeads[column], column, layout, head_y, write,
        undefined, getLongNoteBrightness(note.state), false, config.upsideDown ? 0 : 1, config.longNoteHeadFlipY[column]);
    }
    for (const note of notes) {
      if (note.end_dt !== undefined) continue;
      const column = note.column - 1;
      const y = layout.receptorY + note.start_dt * speed * (config.upsideDown ? 1 : -1);
      this.addSprite(config.shortNotes[column], column, layout, y,
        write, undefined, 1, false, config.upsideDown ? 0 : 1, config.shortNoteFlipY[column]);
    }
  }

  private addReceptor(name: string, column: number, layout: ManiaLayout, write: QuadWriter): void {
    const frame = this.skin.frames[name];
    if (!frame) return;
    const width = layout.columnWidth[column]!;
    const height = frame.sourceSize.h * NOTE_SKIN_LOGICAL_HEIGHT / 768;
    const top = this.skin.config.upsideDown ? 0 : NOTE_SKIN_LOGICAL_HEIGHT - height;
    write(layout.columnLeft[column]!, top, width, height, [1, 1, 1, 1], frame,
      this.skin.config.receptorFlipY[column]);
  }

  private addSprite(name: string, column: number, layout: ManiaLayout, y: number, write: QuadWriter,
    height?: number, brightness = 1, stretch = false, origin_y = 0, flip_y = false): void {
    const frame = this.skin.frames[name];
    if (!frame) return;
    const scale = layout.columnWidth[column]! / frame.sourceSize.w;
    const draw_height = height ?? frame.sourceSize.h * scale;
    if (draw_height <= 0) return;
    const x = layout.columnLeft[column]! + frame.spriteSourceSize.x * scale;
    const top = stretch ? y : y - frame.sourceSize.h * scale * origin_y + frame.spriteSourceSize.y * scale;
    write(x, top, frame.spriteSourceSize.w * scale, stretch ? draw_height : frame.spriteSourceSize.h * scale,
      [brightness, brightness, brightness, 1], frame, flip_y);
  }

  private getSpriteHeight(name: string, column: number, layout: ManiaLayout): number {
    const frame = this.skin.frames[name];
    return frame ? frame.sourceSize.h * layout.columnWidth[column]! / frame.sourceSize.w : 0;
  }

}
