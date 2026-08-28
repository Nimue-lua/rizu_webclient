import { useId, type CSSProperties, type ReactNode } from "react";
import type { NumberDefinition } from "../config/Config";
import { ConfigResetButton } from "./ConfigResetButton";

interface ConfigNumberControlProps {
  readonly definition: NumberDefinition;
  readonly label: string;
  readonly value: number;
  readonly output?: ReactNode;
  readonly onChange: (value: number) => void;
  readonly onReset?: () => void;
}

export function ConfigNumberControl({ definition, label, value, output = value, onChange, onReset }: ConfigNumberControlProps) {
  const input_id = useId();
  const progress = ((value - definition.min) / (definition.max - definition.min)) * 100;
  const style = { "--slider-progress": `${progress}%` } as CSSProperties;

  return (
    <div className="settings-control settings-slider-control">
      <div className="config-control-label">
        {onReset && <ConfigResetButton label={`Reset ${label} to default`} onReset={onReset} />}
        <label htmlFor={input_id}>{label}&nbsp;&nbsp;<output>{output}</output></label>
      </div>
      <input id={input_id} type="range" min={definition.min} max={definition.max} step={definition.step} value={value}
        style={style} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  );
}
