export interface Sprite {
  image: ImageBitmap;
  sourceSize: { w: number; h: number };
  pixelSize: { w: number; h: number };
}

export interface SpriteSkin {
  sprites: Readonly<Record<string, Sprite>>;
}

export type SpriteQuadWriter = (x: number, y: number, width: number, height: number,
  color: readonly [number, number, number, number], sprite: Sprite, flip_y?: boolean,
  batch?: string, rotate_ccw?: boolean, rotation_radians?: number, circular_progress?: number,
  additive?: boolean) => void;

export interface SpriteDrawCommand {
  x: number;
  y: number;
  width: number;
  height: number;
  color: readonly [number, number, number, number];
  sprite: Sprite;
  flipY: boolean;
  rotateCounterClockwise: boolean;
  rotationRadians: number;
  circularProgress?: number;
  additive?: boolean;
  batch?: string;
}
