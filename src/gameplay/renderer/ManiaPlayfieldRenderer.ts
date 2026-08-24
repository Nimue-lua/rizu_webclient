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
  color: readonly [number, number, number, number], frame: NoteSkinFrame) => void;

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
    return { width: viewport_width, height: NOTE_SKIN_LOGICAL_HEIGHT, columnLeft, columnWidth, receptorY: config.hitPosition };
  }

  getTimeRange(layout: ManiaLayout, scroll_speed: number): { past: number; future: number } {
    const seconds_per_pixel = 1 / (NOTE_SKIN_LOGICAL_HEIGHT * scroll_speed);
    const margin = Math.max(...layout.columnWidth);
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
      const head_y = layout.receptorY - note.start_dt * speed;
      const tail_y = layout.receptorY - note.end_dt * speed;
      this.addSprite(config.longNoteBodies[column], column, layout, tail_y, write,
        Math.max(0, head_y - tail_y), getLongNoteBrightness(note.state), true);
      this.addSprite(config.longNoteTails[column], column, layout, tail_y, write,
        undefined, getLongNoteBrightness(note.state), false, 1);
      this.addSprite(config.longNoteHeads[column], column, layout, head_y, write,
        undefined, getLongNoteBrightness(note.state), false, 1);
    }
    for (const note of notes) {
      if (note.end_dt !== undefined) continue;
      const column = note.column - 1;
      this.addSprite(config.shortNotes[column], column, layout, layout.receptorY - note.start_dt * speed,
        write, undefined, 1, false, 1);
    }
  }

  private addReceptor(name: string, column: number, layout: ManiaLayout, write: QuadWriter): void {
    const frame = this.skin.frames[name];
    if (!frame) return;
    const width = layout.columnWidth[column]!;
    const height = frame.sourceSize.h * NOTE_SKIN_LOGICAL_HEIGHT / 768;
    write(layout.columnLeft[column]!, NOTE_SKIN_LOGICAL_HEIGHT - height, width, height, [1, 1, 1, 1], frame);
  }

  private addSprite(name: string, column: number, layout: ManiaLayout, y: number, write: QuadWriter,
    height?: number, brightness = 1, stretch = false, origin_y = 0): void {
    const frame = this.skin.frames[name];
    if (!frame) return;
    const scale = layout.columnWidth[column]! / frame.sourceSize.w;
    const draw_height = height ?? frame.sourceSize.h * scale;
    if (draw_height <= 0) return;
    const x = layout.columnLeft[column]! + frame.spriteSourceSize.x * scale;
    const top = stretch ? y : y - frame.sourceSize.h * scale * origin_y + frame.spriteSourceSize.y * scale;
    write(x, top, frame.spriteSourceSize.w * scale, stretch ? draw_height : frame.spriteSourceSize.h * scale,
      [brightness, brightness, brightness, 1], frame);
  }

}
