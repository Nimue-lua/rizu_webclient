import { useEffect, useState } from "react";
import type { CatalogChart } from "../catalog/CatalogProvider";
import {
  inputCodeLabel,
  inputLayout,
  loadInputBindings,
  saveInputBindings,
} from "../gameplay/InputBindings";

interface InputBindingsModalProps {
  chart: CatalogChart;
  onExit: () => void;
}

export function InputBindingsModal({ chart, onExit }: InputBindingsModalProps) {
  const layout = inputLayout(chart);
  const [bindings, setBindings] = useState(() => loadInputBindings(layout));
  const [listening_index, setListeningIndex] = useState<number | null>(null);

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
    <div className="input-bindings-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onExit();
    }}>
      <section className="input-bindings-modal" role="dialog" aria-modal="true" aria-labelledby="input-bindings-title">
        <h1 id="input-bindings-title">Input Bindings <span>- {layout.name}</span></h1>
        <div className="input-binding-list">
          {bindings.map((binding, index) => (
            <div key={index}>
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
            </div>
          ))}
        </div>
        <p>Left click a frame, then press a key. Right click removes its binding.</p>
      </section>
    </div>
  );
}
