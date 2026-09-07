import { useEffect, useRef, useState, type DragEvent } from "react";
import { X } from "lucide-react";
import {
  compatibleNoteSkins,
  noteSkinSelectionKey,
  type NoteSkinOption,
  type NoteSkinSelections,
} from "../../noteskin/NoteSkinSelection";

interface NoteSkinsModalProps {
  selections: NoteSkinSelections;
  options: readonly NoteSkinOption[];
  selected_mode: string | null;
  selected_column_count: number | null;
  onSelectionChange: (key: string, skin_id: string | undefined) => void;
  onImport: (file: File) => Promise<{ options: readonly NoteSkinOption[]; persisted: boolean }>;
  onDelete: (skin_id: string) => Promise<void>;
  onEdit: () => void;
  onExit: () => void;
}

export function NoteSkinsModal({ selections, options, selected_mode, selected_column_count, onSelectionChange, onImport, onDelete, onEdit, onExit }: NoteSkinsModalProps) {
  const file_input_ref = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [active_mode, setActiveMode] = useState<"osu" | "mania">(selected_mode === "mania" ? "mania" : "osu");
  const [active_column_count, setActiveColumnCount] = useState(selected_mode === "mania" ? selected_column_count ?? 4 : 4);
  const target_column_count = active_mode === "mania" ? active_column_count : null;
  const key_modes = Array.from({ length: 9 }, (_, index) => index + 1);
  if (selected_mode === "mania" && selected_column_count !== null && !key_modes.includes(selected_column_count)) {
    key_modes.push(selected_column_count);
    key_modes.sort((left, right) => left - right);
  }
  const compatible_skins = compatibleNoteSkins(active_mode, target_column_count, options);
  const selection_key = noteSkinSelectionKey(active_mode, target_column_count);
  const stored_skin_id = selections[selection_key] ?? "";
  const selected_skin = compatible_skins.find((skin) => skin.id === stored_skin_id) ??
    compatible_skins.find((skin) => skin.id === "osu-default") ?? compatible_skins[0];
  const selected_skin_id = selected_skin?.id ?? "";
  const target_name = active_mode === "mania" ? `${active_column_count}K MANIA` : "OSU!";
  const can_edit = selected_mode === active_mode &&
    (active_mode !== "mania" || selected_column_count === active_column_count);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onExit();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onExit]);

  const importFile = async (file: File | undefined) => {
    if (!file || importing) return;
    setImporting(true);
    try {
      const imported = await onImport(file);
      const compatible_import = compatibleNoteSkins(active_mode, target_column_count, imported.options)[0];
      if (compatible_import) onSelectionChange(selection_key, compatible_import.id);
    } catch (error) {
      console.error("Could not import note skin", error);
    } finally {
      setImporting(false);
      if (file_input_ref.current) file_input_ref.current.value = "";
    }
  };
  const dropFile = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    void importFile(event.dataTransfer.files[0]);
  };
  const deleteSelected = async () => {
    if (!selected_skin?.local || deleting) return;
    setDeleting(true);
    try {
      await onDelete(selected_skin.id);
    } catch (error) {
      console.error("Could not delete note skin", error);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="modal-layer note-skins-layer" role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onExit(); }}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={dropFile}>
      <section className={`modal-surface note-skins-modal${dragging ? " dragging" : ""}`} role="dialog" aria-modal="true" aria-labelledby="note-skins-title"
        onDragEnter={(event) => event.preventDefault()} onDragOver={(event) => event.preventDefault()}>
        <header>
          <div><h1 id="note-skins-title">Note Skins</h1><p>Choose a skin for <strong>{target_name}</strong>.</p></div>
          <div className="note-skin-target-controls">
            <div className="settings-control settings-segmented-control">
              <span>Gamemode</span>
              <div>
                <button className={active_mode === "osu" ? "selected" : ""} type="button" aria-pressed={active_mode === "osu"} onClick={() => setActiveMode("osu")}>osu!</button>
                <button className={active_mode === "mania" ? "selected" : ""} type="button" aria-pressed={active_mode === "mania"} onClick={() => setActiveMode("mania")}>mania</button>
              </div>
            </div>
            {active_mode === "mania" && <label className="settings-control settings-select-control">
              <span>Key mode</span>
              <select value={active_column_count} onChange={(event) => setActiveColumnCount(Number(event.target.value))}>
                {key_modes.map((key_mode) => <option key={key_mode} value={key_mode}>{key_mode}K</option>)}
              </select>
            </label>}
          </div>
        </header>
        {compatible_skins.length === 0 ? <p className="note-skin-empty">No skins are available for {target_name}.</p> :
          <fieldset className="note-skin-list" aria-label={`Note skins for ${target_name}`}>
            {compatible_skins.map((skin) => <label key={skin.id} className={selected_skin_id === skin.id ? "current" : ""}>
              <input autoFocus={selected_skin_id === skin.id} checked={selected_skin_id === skin.id} type="radio" name="note-skin" value={skin.id} onChange={() => onSelectionChange(selection_key, skin.id)} />
              <span><strong>{skin.name}</strong>{skin.sessionOnly ? <small className="session-only">SESSION ONLY</small> : skin.local ? <small className="local">IMPORTED</small> : skin.columnCount === null && active_mode === "mania" && <small>ALL KEY MODES</small>}</span>
            </label>)}
          </fieldset>}
        <footer>
          <button className="modal-close-button" type="button" onClick={onExit}>
            <X aria-hidden="true" />
            <span>Close</span>
          </button>
          <div className="note-skin-actions">
            {selected_skin?.local && <button className="danger" type="button" disabled={deleting} onClick={() => void deleteSelected()}>{deleting ? "DELETING..." : "DELETE"}</button>}
            <button type="button" disabled={!selected_skin || !can_edit} title={can_edit ? undefined : "Select a matching chart to edit this skin"} onClick={onEdit}>EDIT</button>
            <div className="note-skin-import">
              <input ref={file_input_ref} type="file" accept=".osk" onChange={(event) => void importFile(event.target.files?.[0])} />
              <button type="button" disabled={importing} onClick={() => file_input_ref.current?.click()}>{importing ? "IMPORTING..." : "IMPORT .OSK"}</button>
            </div>
          </div>
        </footer>
        {dragging && <div className="note-skin-drop-overlay">DROP .OSK TO IMPORT</div>}
      </section>
    </div>
  );
}
