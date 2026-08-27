export type ColumnColorName = "white" | "pink" | "yellow";
export type ColumnColor = readonly [number, number, number, number];

export const column_colors: Readonly<Record<ColumnColorName, ColumnColor>> = {
  white: [1, 1, 1, 1],
  pink: [0x35 / 255, 0xc8 / 255, 1, 1],
  yellow: [1, 0.87, 0.24, 1],
};

const predefined_colors: Readonly<Record<number, readonly ColumnColorName[]>> = {
  1: ["yellow"],
  2: ["white", "pink"],
  3: ["white", "pink", "white"],
  4: ["white", "pink", "pink", "white"],
  5: ["white", "pink", "yellow", "pink", "white"],
  7: ["white", "pink", "white", "yellow", "white", "pink", "white"],
};

export function getColumnColorNames(column_count: number): readonly ColumnColorName[] {
  if (!Number.isInteger(column_count) || column_count <= 0) return [];
  let structure: number;
  if (column_count < 5) structure = (column_count - 1) % 4 + 1;
  else if (column_count % 5 === 0) structure = 5;
  else if (column_count % 6 === 0) structure = 3;
  else if (column_count % 7 === 0) structure = 7;
  else structure = column_count % 2 === 0 ? 4 : 3;

  const pattern = predefined_colors[structure];
  let colors = pattern && column_count % structure === 0
    ? Array.from({ length: column_count / structure }, () => pattern).flat()
    : [];
  if (colors.length !== column_count) {
    colors = Array.from({ length: column_count }, (_, index) => index % 2 === 0 ? "pink" : "white");
  }
  if (column_count % 2 !== 0) colors[Math.floor(column_count / 2)] = "yellow";
  return colors;
}

export function getColumnColors(column_count: number): readonly ColumnColor[] {
  return getColumnColorNames(column_count).map((name) => column_colors[name]);
}
