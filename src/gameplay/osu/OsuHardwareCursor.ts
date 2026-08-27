import type { Sprite } from "../renderer/Sprite";

const OSU_STAGE_WIDTH = 640;
const OSU_STAGE_HEIGHT = 480;
const MAX_CSS_CURSOR_SIZE = 128;

export type OsuCursorRendererMode = "os" | "webgl";

export function osuCursorRendererMode(value: string | null): OsuCursorRendererMode {
  return value === "webgl" ? "webgl" : "os";
}

export function osuHardwareCursorSize(sprite: Sprite, client_width: number, client_height: number,
  cursor_scale: number): { width: number; height: number } {
  const stage_scale = Math.min(client_width / OSU_STAGE_WIDTH, client_height / OSU_STAGE_HEIGHT);
  const requested_scale = Math.max(0, stage_scale * cursor_scale);
  const limit_scale = Math.min(1, MAX_CSS_CURSOR_SIZE / (Math.max(sprite.sourceSize.w, sprite.sourceSize.h) * requested_scale));
  return {
    width: Math.max(1, Math.round(sprite.sourceSize.w * requested_scale * limit_scale)),
    height: Math.max(1, Math.round(sprite.sourceSize.h * requested_scale * limit_scale)),
  };
}

export function bindOsuHardwareCursor(canvas: HTMLCanvasElement, sprite: Sprite, cursor_scale: number): () => void {
  const update = () => {
    const size = osuHardwareCursorSize(sprite, canvas.clientWidth, canvas.clientHeight, cursor_scale);
    const image = document.createElement("canvas");
    image.width = size.width;
    image.height = size.height;
    const context = image.getContext("2d");
    if (!context) return;
    context.drawImage(sprite.image, 0, 0, size.width, size.height);
    canvas.style.cursor = `url("${image.toDataURL("image/png")}") ${Math.floor(size.width / 2)} ${Math.floor(size.height / 2)}, crosshair`;
  };
  const resize_observer = new ResizeObserver(update);
  resize_observer.observe(canvas);
  update();
  return () => {
    resize_observer.disconnect();
    canvas.style.cursor = "";
  };
}
