export interface OsuNote {
  column: number;
  start_time: number;
  end_time?: number;
}

export interface OsuChart {
  column_count: number;
  notes: OsuNote[];
}

export function parseOsuChart(source: string): OsuChart {
  let section = "";
  let column_count: number | null = null;
  const notes: OsuNote[] = [];

  for (const raw_line of source.split("\n")) {
    const line = raw_line.trim();
    const section_match = line.match(/^\[(.+)]$/);

    if (section_match) {
      section = section_match[1] ?? "";
      continue;
    }

    const property_match = line.match(/^([A-Za-z]+):\s?(.*)$/);

    if (property_match) {
      if (property_match[1] === "CircleSize") {
        const value = Number(property_match[2]);

        if (!Number.isInteger(value) || value <= 0) {
          throw new Error("Chart has an invalid CircleSize");
        }

        column_count = value;
      }

      continue;
    }

    if (section !== "HitObjects" || line === "") {
      continue;
    }

    if (column_count === null) {
      throw new Error("Chart is missing CircleSize");
    }

    const fields = line.split(",");
    const x = Number(fields[0]);
    const start_time = Number(fields[2]);
    const type = Number(fields[3]);

    if (!Number.isFinite(x) || !Number.isFinite(start_time) || !Number.isInteger(type)) {
      throw new Error(`Invalid hit object: ${line}`);
    }

    const column = Math.min(
      Math.max(Math.ceil((x / 512) * column_count), 1),
      column_count,
    );
    const note: OsuNote = { column, start_time };

    if ((type & 128) === 128) {
      const end_time = Number(fields[5]?.split(":", 1)[0]);

      if (!Number.isFinite(end_time)) {
        throw new Error(`Invalid hold note: ${line}`);
      }

      note.end_time = end_time;
    }

    notes.push(note);
  }

  if (column_count === null) {
    throw new Error("Chart is missing CircleSize");
  }

  return { column_count, notes };
}
