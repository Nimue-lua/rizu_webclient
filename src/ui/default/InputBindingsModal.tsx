import { useEffect, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import type { Chartview } from "../../library/views";
import {
  inputCodeLabel,
  inputLayout,
  loadInputBindings,
  saveInputBindings,
} from "../../gameplay/InputBindings";
import { getColumnColors } from "../../gameplay/mania/ColumnColors";

interface InputBindingsModalProps {
  chart: Chartview;
  onExit: () => void;
}

export function InputBindingsModal({ chart, onExit }: InputBindingsModalProps) {
  const initial_layout = inputLayout(chart);
  const [active_mode, setActiveMode] = useState(chart.mode >= 0 && chart.mode <= 3 ? chart.mode : 0);
  const [active_column_count, setActiveColumnCount] = useState(chart.mode === 3 ? chart.keys ?? 4 : 4);
  const layout = inputLayout({ mode: active_mode, keys: active_mode === 3 ? active_column_count : null });
  const [bindings, setBindings] = useState(() => loadInputBindings(initial_layout));
  const [listening_index, setListeningIndex] = useState<number | null>(null);
  const colors = getColumnColors(layout.count);
  const key_modes = Array.from({ length: 9 }, (_, index) => index + 1);
  if (chart.mode === 3 && chart.keys !== null && !key_modes.includes(chart.keys)) {
    key_modes.push(chart.keys);
    key_modes.sort((left, right) => left - right);
  }

  useEffect(() => {
    setBindings(loadInputBindings(layout));
    setListeningIndex(null);
  }, [layout.count, layout.mode]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (listening_index === null) {
        if (event.key === "Escape") onExit();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setListeningIndex(null);
        return;
      }

      setBindings((current_bindings) => {
        const next_bindings = current_bindings.map((binding) => binding === event.code ? null : binding);
        next_bindings[listening_index] = event.code;
        saveInputBindings(layout, next_bindings);
        return next_bindings;
      });
      setListeningIndex(listening_index + 1 < layout.count ? listening_index + 1 : null);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [layout.count, layout.mode, listening_index, onExit]);

  const removeBinding = (index: number) => {
    setBindings((current_bindings) => {
      const next_bindings = [...current_bindings];
      next_bindings[index] = null;
      saveInputBindings(layout, next_bindings);
      return next_bindings;
    });
    setListeningIndex(null);
  };

  return (
    <div className="modal-layer input-bindings-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onExit();
    }}>
      <section className="modal-surface input-bindings-modal" role="dialog" aria-modal="true" aria-labelledby="input-bindings-title">
        <header>
          <div>
            <h1 id="input-bindings-title">Input Bindings</h1>
            <p>Configure controls for <strong>{layout.name}</strong>.</p>
          </div>
          <div className="input-binding-target-controls">
            <div className="settings-control settings-segmented-control">
              <span>Gamemode</span>
              <div>
                {(["osu!", "taiko", "fruits", "mania"] as const).map((name, mode) =>
                  <button key={name} className={active_mode === mode ? "selected" : ""} type="button"
                    aria-pressed={active_mode === mode} onClick={() => setActiveMode(mode)}>{name}</button>)}
              </div>
            </div>
            {active_mode === 3 && <label className="settings-control settings-select-control">
              <span>Key mode</span>
              <select value={active_column_count} onChange={(event) => setActiveColumnCount(Number(event.target.value))}>
                {key_modes.map((key_mode) => <option key={key_mode} value={key_mode}>{key_mode}K</option>)}
              </select>
            </label>}
          </div>
        </header>
        <div className={`input-binding-list${active_mode === 3 ? " mania" : " standard"}`}>
          {Array.from({ length: layout.count }, (_, index) => {
            const binding = bindings[index] ?? null;
            return <div key={index} style={{
              "--column-color": `rgb(${colors[index]!.slice(0, 3).map((channel) => Math.round(channel * 255)).join(" ")})`,
            } as CSSProperties}>
              <span>{index + 1}K</span>
              <button
                autoFocus={index === 0}
                className={listening_index === index ? "listening" : ""}
                type="button"
                aria-label={`Bind input ${index + 1}`}
                onClick={() => setListeningIndex(index)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  removeBinding(index);
                }}
              >
                {listening_index === index ? "..." : binding ? inputCodeLabel(binding) : "-"}
              </button>
            </div>;
          })}
        </div>
        <footer>
          <button className="modal-close-button" type="button" onClick={onExit}>
            <X aria-hidden="true" />
            <span>Close</span>
          </button>
          <span>Left click a key, then press a button. Right click removes its binding.</span>
        </footer>
      </section>
    </div>
  );
}
