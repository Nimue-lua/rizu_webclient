import type { ChartSelectorSnapshot, ChartSortMode } from "../../select/ChartSelector";
import { mode_names, SongSelectIcon, sort_names } from "./SongSelectUi";

interface LibraryToolbarProps {
  selection: ChartSelectorSnapshot;
  onLocationChange: (location_id: number | null) => void;
  onOpenFilters: () => void;
  onQueryChange: (query: string) => void;
  onSortChange: (sort_mode: ChartSortMode) => void;
}

export function LibraryToolbar({ selection, onLocationChange, onOpenFilters, onQueryChange, onSortChange }: LibraryToolbarProps) {
  const collection_name = selection.selected_location_id === null
    ? "All songs"
    : selection.locations.find((location) => location.id === selection.selected_location_id)?.name ?? "All songs";

  return (
    <section className="library-toolbar" aria-label="Chart library controls">
      <label className="collection-button">
        <span><small>COLLECTION</small><strong>{collection_name}</strong></span>
        <select aria-label="Collection" value={selection.selected_location_id ?? ""} onChange={(event) => onLocationChange(event.target.value === "" ? null : Number(event.target.value))}>
          <option value="">All songs</option>
          {selection.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
        <SongSelectIcon name="chevron-down" />
      </label>
      <label className="toolbar-button sort-button">
        <SongSelectIcon name="arrow-up-down" />
        <span><small>SORT</small><strong>{sort_names[selection.sort_mode]}</strong></span>
        <select aria-label="Sort charts" value={selection.sort_mode} onChange={(event) => onSortChange(event.target.value as ChartSortMode)}>
          <option value="title">Title</option><option value="artist">Artist</option>
          <option value="difficulty">Difficulty</option><option value="duration">Duration</option>
        </select>
      </label>
      <button className="toolbar-button" aria-haspopup="dialog" onClick={onOpenFilters}>
        <SongSelectIcon name="filter" /><span><small>FILTERS</small><strong>{selection.selected_mode === null ? "None" : mode_names[selection.selected_mode]}</strong></span>
      </button>
      <label className="chart-search">
        <SongSelectIcon name="search" />
        <input value={selection.query} onChange={(event) => onQueryChange(event.target.value)} type="search" placeholder="Search or filter: keys=4 difficulty>5 length<2m" aria-label="Search charts" />
      </label>
    </section>
  );
}
