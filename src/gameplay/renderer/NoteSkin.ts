export interface NoteSkin {
  background_color: readonly [number, number, number, number];
  receptor_color: readonly [number, number, number, number];
  note_color: readonly [number, number, number, number];
  long_note_body_color: readonly [number, number, number, number];
  logical_height: number;
  receptor_bottom_margin: number;
  max_note_radius: number;
  column_gap: number;
}

export const default_note_skin: NoteSkin = {
  background_color: [0.035, 0.035, 0.045, 1],
  receptor_color: [0.3, 0.75, 1, 1],
  note_color: [1, 1, 1, 1],
  long_note_body_color: [0.65, 0.85, 1, 0.8],
  logical_height: 480,
  receptor_bottom_margin: 80,
  max_note_radius: 30,
  column_gap: 2,
};
