export type SkinIniSection = Readonly<Record<string, string>>;

export interface SkinIni {
  readonly sections: Readonly<Record<string, SkinIniSection>>;
  readonly mania: readonly SkinIniSection[];
}

export function parseSkinIni(source: string): SkinIni {
  const sections: Record<string, Record<string, string>> = {};
  const mania: Record<string, string>[] = [];
  let current: Record<string, string> | undefined;

  for (const source_line of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = source_line.trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      const name = header[1]!.trim();
      if (name.toLowerCase() === "mania") {
        current = {};
        mania.push(current);
      } else {
        current = sections[name] ??= {};
      }
      continue;
    }
    const separator = line.indexOf(":");
    if (!current || separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).replace(/\/\/.*$/, "").trim();
    if (key) current[key] = value;
  }
  return { sections, mania };
}
