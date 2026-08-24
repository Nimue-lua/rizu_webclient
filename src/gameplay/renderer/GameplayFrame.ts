export const GAMEPLAY_LOGICAL_HEIGHT = 480;

export interface GameplayFrame {
  readonly framebuffer_width: number;
  readonly framebuffer_height: number;
  readonly logical_width: number;
  readonly logical_height: number;
}

export function resizeGameplayCanvas(canvas: HTMLCanvasElement, device_pixel_ratio: number): GameplayFrame {
  const ratio = Number.isFinite(device_pixel_ratio) && device_pixel_ratio > 0 ? device_pixel_ratio : 1;
  const framebuffer_width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const framebuffer_height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== framebuffer_width || canvas.height !== framebuffer_height) {
    canvas.width = framebuffer_width;
    canvas.height = framebuffer_height;
  }
  return {
    framebuffer_width,
    framebuffer_height,
    logical_width: GAMEPLAY_LOGICAL_HEIGHT * framebuffer_width / framebuffer_height,
    logical_height: GAMEPLAY_LOGICAL_HEIGHT,
  };
}
