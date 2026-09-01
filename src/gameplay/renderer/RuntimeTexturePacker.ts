export interface RuntimeTextureSource<T> {
  value: T;
  image: ImageBitmap;
}

export interface PackedTexture<T> {
  value: T;
  image: RuntimeTextureSource<T>["image"];
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RuntimeTexturePage<T> {
  width: number;
  height: number;
  entries: PackedTexture<T>[];
}

export interface RuntimeTextureLayout<T> {
  pages: RuntimeTexturePage<T>[];
  standalone: RuntimeTextureSource<T>[];
  extrusion: number;
  padding: number;
}

export interface RuntimeTexturePackerOptions {
  maxWidth: number;
  maxHeight: number;
  extrusion?: number;
  padding?: number;
}

export interface RuntimeTextureAtlas<T> extends RuntimeTexturePage<T> {
  canvas: HTMLCanvasElement;
}

function requireNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
}

export function packRuntimeTextureLayout<T>(sources: readonly RuntimeTextureSource<T>[],
  options: RuntimeTexturePackerOptions): RuntimeTextureLayout<T> {
  requireNonNegativeInteger("maxWidth", options.maxWidth);
  requireNonNegativeInteger("maxHeight", options.maxHeight);
  const extrusion = options.extrusion ?? 1;
  const padding = options.padding ?? 0;
  requireNonNegativeInteger("extrusion", extrusion);
  requireNonNegativeInteger("padding", padding);
  if (options.maxWidth === 0 || options.maxHeight === 0) throw new Error("Atlas dimensions must be positive");
  const margin = extrusion + padding;
  const indexed = sources.map((source, index) => ({ source, index }));
  for (const { source } of indexed) {
    if (!Number.isInteger(source.image.width) || !Number.isInteger(source.image.height)
      || source.image.width <= 0 || source.image.height <= 0) {
      throw new Error("Texture dimensions must be positive integers");
    }
  }
  indexed.sort((a, b) => b.source.image.height - a.source.image.height
    || b.source.image.width - a.source.image.width || a.index - b.index);

  const pages: RuntimeTexturePage<T>[] = [];
  const standalone: RuntimeTextureSource<T>[] = [];
  let page: RuntimeTexturePage<T> | undefined;
  let x = margin;
  let y = margin;
  let row_height = 0;
  for (const { source } of indexed) {
    const packed_width = source.image.width + margin * 2;
    const packed_height = source.image.height + margin * 2;
    if (packed_width > options.maxWidth || packed_height > options.maxHeight) {
      standalone.push(source);
      continue;
    }
    if (!page) {
      page = { width: 0, height: 0, entries: [] };
      pages.push(page);
    }
    if (x + source.image.width + margin > options.maxWidth) {
      x = margin;
      y += row_height;
      row_height = 0;
    }
    if (y + source.image.height + margin > options.maxHeight) {
      page = { width: 0, height: 0, entries: [] };
      pages.push(page);
      x = margin;
      y = margin;
    }
    const entry: PackedTexture<T> = {
      value: source.value,
      image: source.image,
      page: pages.length - 1,
      x,
      y,
      width: source.image.width,
      height: source.image.height,
    };
    page.entries.push(entry);
    page.width = Math.max(page.width, x + source.image.width + margin);
    page.height = Math.max(page.height, y + source.image.height + margin);
    x += packed_width;
    row_height = Math.max(row_height, packed_height);
  }
  return { pages, standalone, extrusion, padding };
}

function drawExtruded(context: CanvasRenderingContext2D, entry: PackedTexture<unknown>, extrusion: number): void {
  const { image, x, y, width, height } = entry;
  context.drawImage(image, x, y, width, height);
  if (extrusion === 0) return;
  context.drawImage(image, 0, 0, 1, height, x - extrusion, y, extrusion, height);
  context.drawImage(image, width - 1, 0, 1, height, x + width, y, extrusion, height);
  context.drawImage(image, 0, 0, width, 1, x, y - extrusion, width, extrusion);
  context.drawImage(image, 0, height - 1, width, 1, x, y + height, width, extrusion);
  context.drawImage(image, 0, 0, 1, 1, x - extrusion, y - extrusion, extrusion, extrusion);
  context.drawImage(image, width - 1, 0, 1, 1, x + width, y - extrusion, extrusion, extrusion);
  context.drawImage(image, 0, height - 1, 1, 1, x - extrusion, y + height, extrusion, extrusion);
  context.drawImage(image, width - 1, height - 1, 1, 1,
    x + width, y + height, extrusion, extrusion);
}

export function createRuntimeTextureAtlases<T>(layout: RuntimeTextureLayout<T>,
  createCanvas: (width: number, height: number) => HTMLCanvasElement = (width, height) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }): RuntimeTextureAtlas<T>[] {
  return layout.pages.map((page) => {
    const canvas = createCanvas(page.width, page.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Failed to create texture atlas canvas");
    for (const entry of page.entries) drawExtruded(context, entry, layout.extrusion);
    return { ...page, canvas };
  });
}
