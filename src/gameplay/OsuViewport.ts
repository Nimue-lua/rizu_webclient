export const OSU_STAGE_WIDTH = 640;
export const OSU_STAGE_HEIGHT = 480;
export const OSU_PLAYFIELD_WIDTH = 512;
export const OSU_PLAYFIELD_HEIGHT = 384;
export const OSU_PLAYFIELD_LEFT = 64;
export const OSU_PLAYFIELD_TOP = 48;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface ClientBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export class OsuViewport {
  readonly scale: number;
  readonly stage_left: number;
  readonly stage_top: number;

  constructor(readonly logical_width: number, readonly logical_height: number,
    readonly x_flip = false, readonly y_flip = false) {
    if (!Number.isFinite(logical_width) || logical_width <= 0 ||
      !Number.isFinite(logical_height) || logical_height <= 0) {
      throw new RangeError("Osu viewport dimensions must be positive and finite");
    }
    this.scale = Math.min(1, logical_width / OSU_STAGE_WIDTH, logical_height / OSU_STAGE_HEIGHT);
    this.stage_left = (logical_width - OSU_STAGE_WIDTH * this.scale) / 2;
    this.stage_top = (logical_height - OSU_STAGE_HEIGHT * this.scale) / 2;
    Object.freeze(this);
  }

  playfieldToScreen(point: Point): Point {
    const x = this.x_flip ? OSU_PLAYFIELD_WIDTH - point.x : point.x;
    const y = this.y_flip ? OSU_PLAYFIELD_HEIGHT - point.y : point.y;
    return {
      x: this.stage_left + (OSU_PLAYFIELD_LEFT + x) * this.scale,
      y: this.stage_top + (OSU_PLAYFIELD_TOP + y) * this.scale,
    };
  }

  screenToPlayfield(point: Point): Point {
    let x = (point.x - this.stage_left) / this.scale - OSU_PLAYFIELD_LEFT;
    let y = (point.y - this.stage_top) / this.scale - OSU_PLAYFIELD_TOP;
    if (this.x_flip) x = OSU_PLAYFIELD_WIDTH - x;
    if (this.y_flip) y = OSU_PLAYFIELD_HEIGHT - y;
    return { x, y };
  }

  clientToPlayfield(point: Point, bounds: ClientBounds): Point {
    if (!Number.isFinite(bounds.width) || bounds.width <= 0 ||
      !Number.isFinite(bounds.height) || bounds.height <= 0) {
      throw new RangeError("Canvas bounds must be positive and finite");
    }
    return this.screenToPlayfield({
      x: (point.x - bounds.left) / bounds.width * this.logical_width,
      y: (point.y - bounds.top) / bounds.height * this.logical_height,
    });
  }
}
