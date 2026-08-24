import { useEffect } from "react";
import {
  noteSkinSelectionKey,
  note_skin_options,
  type NoteSkinSelections,
} from "../gameplay/renderer/NoteSkinSelection";

interface NoteSkinsModalProps {
  selections: NoteSkinSelections;
  selected_column_count: number | null;
  onSelectionChange: (key: string, skin_id: string | undefined) => void;
  onExit: () => void;
}

export function noteSkinColumnCounts(selected_column_count: number | null): readonly number[] {
  const maximum = Math.max(88, selected_column_count ?? 0,
    ...note_skin_options.flatMap((skin) => skin.mode === "mania" && skin.columnCount !== null ? [skin.columnCount] : []));
  return Array.from({ length: maximum }, (_, index) => index + 1);
}

export function NoteSkinsModal({ selections, selected_column_count, onSelectionChange, onExit }: NoteSkinsModalProps) {
  const column_counts = noteSkinColumnCounts(selected_column_count);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onExit();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onExit]);

  return (
    <div className="note-skins-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onExit();
    }}>
      <section className="note-skins-modal" role="dialog" aria-modal="true" aria-labelledby="note-skins-title">
        <header>
          <div><span>GAMEPLAY</span><h1 id="note-skins-title">Note Skins</h1></div>
          <p>Choose a skin independently for every mania key mode.</p>
        </header>
        <div className="note-skin-list">
          {column_counts.map((column_count) => {
            const key = noteSkinSelectionKey("mania", column_count);
            const compatible_skins = note_skin_options.filter((skin) => skin.mode === "mania" &&
              (skin.columnCount === null || skin.columnCount === column_count));
            return (
              <label key={key} className={selected_column_count === column_count ? "current" : ""}>
                <span><strong>{column_count}K</strong>{selected_column_count === column_count && <small>SELECTED CHART</small>}</span>
                <select
                  autoFocus={selected_column_count === column_count}
                  value={selections[key] ?? ""}
                  onChange={(event) => onSelectionChange(key, event.target.value)}
                  aria-label={`${column_count} key note skin`}
                >
                  <option value="">Not selected</option>
                  {compatible_skins.map((skin) => <option key={skin.id} value={skin.id}>{skin.name}</option>)}
                </select>
              </label>
            );
          })}
        </div>
        <footer><span>Selections are saved automatically.</span><button type="button" onClick={onExit}>CLOSE</button></footer>
      </section>
    </div>
  );
}
