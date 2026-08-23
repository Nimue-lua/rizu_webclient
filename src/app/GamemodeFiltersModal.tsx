import { useEffect } from "react";

const gamemodes = ["osu!", "taiko", "fruits", "mania"] as const;

interface GamemodeFiltersModalProps {
  selected_mode: number | null;
  onModeChange: (mode: number | null) => void;
  onExit: () => void;
}

export function GamemodeFiltersModal({ selected_mode, onModeChange, onExit }: GamemodeFiltersModalProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onExit();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onExit]);

  return (
    <div className="filters-modal-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onExit();
    }}>
      <section className="filters-modal" role="dialog" aria-modal="true" aria-labelledby="filters-title">
        <h1 id="filters-title">Filters</h1>
        <fieldset className="gamemode-filter-list">
          <legend>Gamemode</legend>
          <label><input autoFocus type="radio" name="gamemode" checked={selected_mode === null} onChange={() => onModeChange(null)} />All</label>
          {gamemodes.map((gamemode, mode) => (
            <label key={gamemode}><input type="radio" name="gamemode" checked={selected_mode === mode} onChange={() => onModeChange(mode)} />{gamemode}</label>
          ))}
        </fieldset>
      </section>
    </div>
  );
}
