export interface NoteSkin {
  background_color: readonly [number, number, number, number];
  receptor_color: readonly [number, number, number, number];
  note_color: readonly [number, number, number, number];
  receptor_bottom_margin: number;
  max_note_radius: number;
  column_gap: number;
}

export const default_note_skin: NoteSkin = {
  background_color: [0.035, 0.035, 0.045, 1],
  receptor_color: [0.3, 0.75, 1, 1],
  note_color: [1, 1, 1, 1],
  receptor_bottom_margin: 96,
  max_note_radius: 84,
  column_gap: 3,
};
