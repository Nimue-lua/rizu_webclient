import type { CSSProperties } from "react";
import type { NumberDefinition } from "../config/Config";

interface ConfigNumberControlProps {
  readonly definition: NumberDefinition;
  readonly label: string;
  readonly value: number;
  readonly onChange: (value: number) => void;
}

export function ConfigNumberControl({ definition, label, value, onChange }: ConfigNumberControlProps) {
  const progress = ((value - definition.min) / (definition.max - definition.min)) * 100;
  const style = { "--slider-progress": `${progress}%` } as CSSProperties;

  return (
    <div className="settings-control settings-slider-control">
      <label>{label}&nbsp;&nbsp;<output>{value}</output></label>
      <input type="range" min={definition.min} max={definition.max} step={definition.step} value={value}
        style={style} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  );
}
