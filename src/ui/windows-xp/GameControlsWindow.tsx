import { useEffect, useState } from "react";
import {
  inputCodeLabel,
  loadInputBindings,
  saveInputBindings,
  type InputLayout,
} from "../../gameplay/InputBindings";

const layouts: readonly InputLayout[] = [
  { count: 2, mode: 0, name: "OSU!" },
  { count: 4, mode: 1, name: "TAIKO" },
  { count: 3, mode: 2, name: "FRUITS" },
  ...Array.from({ length: 9 }, (_, index) => ({ count: index + 1, mode: 3, name: `${index + 1}K` })),
];

const action_names: Readonly<Record<number, readonly string[]>> = {
  0: ["Left click", "Right click"],
  1: ["Left rim", "Left drum", "Right drum", "Right rim"],
  2: ["Move left", "Dash", "Move right"],
};

function actionName(layout: InputLayout, index: number) {
  return layout.mode === 3 ? `Column ${index + 1}` : action_names[layout.mode]?.[index] ?? `Action ${index + 1}`;
}

export function GameControlsWindow() {
  const [layout_index, setLayoutIndex] = useState(6);
  const layout = layouts[layout_index]!;
  const [bindings, setBindings] = useState(() => loadInputBindings(layout));
  const [listening_index, setListeningIndex] = useState<number | null>(null);

  useEffect(() => {
    setBindings(loadInputBindings(layout));
    setListeningIndex(null);
  }, [layout.count, layout.mode]);

  useEffect(() => {
    if (listening_index === null) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setListeningIndex(null);
        return;
      }

      setBindings((current) => {
        const next = current.map((binding) => binding === event.code ? null : binding);
        next[listening_index] = event.code;
        saveInputBindings(layout, next);
        return next;
      });
      setListeningIndex(listening_index + 1 < layout.count ? listening_index + 1 : null);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [layout.count, layout.mode, listening_index]);

  const clearBinding = (index: number) => {
    const next = [...bindings];
    next[index] = null;
    setBindings(next);
    saveInputBindings(layout, next);
    setListeningIndex(null);
  };

  const restoreDefaults = () => {
    saveInputBindings(layout, []);
    const defaults = loadInputBindings(layout);
    setBindings(defaults);
    saveInputBindings(layout, defaults);
    setListeningIndex(null);
  };

  return (
    <section className="windows-xp-game-controls">
      <header className="windows-xp-controls-intro">
        <img src="/dmca_incoming/game_controller.avif" alt="" />
        <div>
          <strong>Game Controls</strong>
          <p>Choose a game mode, then assign a keyboard key to each gameplay action.</p>
        </div>
      </header>

      <fieldset className="windows-xp-controls-profile">
        <legend>Control profile</legend>
        <label htmlFor="windows-xp-control-profile">Game mode:</label>
        <select id="windows-xp-control-profile" value={layout_index}
          onChange={(event) => setLayoutIndex(Number(event.target.value))}>
          <optgroup label="Game modes">
            {layouts.slice(0, 3).map((item, index) => <option key={item.mode} value={index}>{item.name}</option>)}
          </optgroup>
          <optgroup label="Mania key modes">
            {layouts.slice(3).map((item, index) => <option key={item.name} value={index + 3}>Mania {item.name}</option>)}
          </optgroup>
        </select>
      </fieldset>

      <fieldset className="windows-xp-controls-bindings">
        <legend>Key assignments</legend>
        <div className="windows-xp-controls-table" role="table" aria-label={`${layout.name} key assignments`}>
          <div className="windows-xp-controls-table-header" role="row">
            <span role="columnheader">Action</span>
            <span role="columnheader">Assigned key</span>
            <span role="columnheader">Change</span>
          </div>
          {bindings.map((binding, index) => (
            <div className={listening_index === index ? "listening" : ""} role="row" key={index}>
              <span role="cell">{actionName(layout, index)}</span>
              <kbd role="cell">{listening_index === index ? "Press a key..." : binding ? inputCodeLabel(binding) : "Not assigned"}</kbd>
              <span className="windows-xp-control-actions" role="cell">
                <button type="button" onClick={() => setListeningIndex((current) => current === index ? null : index)}>
                  {listening_index === index ? "Cancel" : "Change..."}
                </button>
                <button type="button" disabled={!binding} onClick={() => clearBinding(index)}>Clear</button>
              </span>
            </div>
          ))}
        </div>
      </fieldset>

      <footer className="windows-xp-controls-footer">
        <button type="button" onClick={restoreDefaults}>Restore Defaults</button>
      </footer>
    </section>
  );
}
