import { useEffect, useState, type ChangeEvent, type DragEvent } from "react";
import { ArrowLeft, FileArchive, Play, Upload } from "lucide-react";
import { inputLayout, loadInputBindings } from "../gameplay/InputBindings";
import type { OszArchive } from "../library/OszArchive";
import type { Chartview } from "../library/views";
import { ChartModeBadge } from "./song-select/SongSelectUi";

interface OszSelectScreenProps {
  archive: OszArchive | null;
  importing: boolean;
  import_error: string | null;
  onBack: () => void;
  onImport: (file: File) => void;
  onPlay: (chart: Chartview, input_bindings: readonly (string | null)[], song: { title: string; artist: string }) => void;
}

function formatDuration(seconds: number): string {
  const rounded_seconds = Math.round(seconds);
  return `${Math.floor(rounded_seconds / 60)}:${String(rounded_seconds % 60).padStart(2, "0")}`;
}

export function OszSelectScreen({ archive, importing, import_error, onBack, onImport, onPlay }: OszSelectScreenProps) {
  const [selected_id, setSelectedId] = useState(archive?.song.charts[0]?.id ?? "");
  const [dragging, setDragging] = useState(false);
  const selected_chart = archive?.song.charts.find((chart) => chart.id === selected_id) ?? archive?.song.charts[0];

  useEffect(() => setSelectedId(archive?.song.charts[0]?.id ?? ""), [archive]);

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onImport(file);
    event.target.value = "";
  };
  const dropFile = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    const file = [...event.dataTransfer.files].find((candidate) => candidate.name.toLowerCase().endsWith(".osz"));
    if (file) onImport(file);
  };
  const play = () => {
    if (archive && selected_chart) onPlay(selected_chart, loadInputBindings(inputLayout(selected_chart)), archive.song);
  };

  return (
    <main className={`osz-select-screen${dragging ? " dragging" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={dropFile}>
      {selected_chart?.background_url && <img className="osz-background" src={selected_chart.background_url} alt="" />}
      <header className="osz-header">
        <button type="button" onClick={onBack}><ArrowLeft /> Library</button>
        <span><FileArchive /> {archive?.file_name ?? "Opening beatmap archive..."}</span>
        <label className={importing ? "disabled" : ""}><Upload /> Replace archive<input type="file" accept=".osz,application/zip" disabled={importing} onChange={chooseFile} /></label>
      </header>
      <section className="osz-heading">
        <h1>{archive?.song.title ?? (import_error ? "Import failed" : "Opening beatmap set")}</h1>
        {archive ? <><p>{archive.song.artist}</p><small>{archive.song.charts.length} playable {archive.song.charts.length === 1 ? "chart" : "charts"}</small></>
          : <p className={import_error ? "osz-import-error" : "osz-import-status"}>{import_error ?? "Reading charts and assets..."}</p>}
      </section>
      <section className="osz-picker" aria-label="Charts in archive">
        {archive && import_error && <div className="osz-inline-error" role="alert">{import_error}</div>}
        {archive?.song.charts.map((chart) => (
          <button key={chart.id} type="button" className={chart.id === selected_chart?.id ? "selected" : ""} onClick={() => setSelectedId(chart.id)} onDoubleClick={play}>
            <i><ChartModeBadge chart={chart} /></i>
            <span><strong>{chart.name}</strong><small>mapped by {chart.creator}</small></span>
            <span className="osz-chart-stats"><b>{chart.mode === 3 ? `${chart.keys}K` : "osu!"}</b><small>{formatDuration(chart.duration_seconds)} · {chart.note_count} notes · {Math.round(chart.bpm_avg)} BPM</small></span>
          </button>
        ))}
        {!archive && <div className={`osz-import-message${import_error ? " error" : ""}`}>
          <FileArchive />
          <strong>{import_error ?? "Importing .osz..."}</strong>
          <span>{import_error ? "Drop another .osz or choose Replace archive to try again." : "The chart list will appear when the archive is ready."}</span>
        </div>}
      </section>
      <footer className="osz-footer">
        <div><span>SELECTED DIFFICULTY</span><strong>{selected_chart?.name ?? (importing ? "Importing..." : "No chart available")}</strong></div>
        <button type="button" disabled={!selected_chart || importing} onClick={play}><Play fill="currentColor" /> Play chart</button>
      </footer>
      {dragging && <div className="osz-drop-overlay">DROP .OSZ TO OPEN</div>}
    </main>
  );
}
