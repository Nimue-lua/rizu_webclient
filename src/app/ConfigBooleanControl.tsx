import type { BooleanDefinition } from "../config/Config";

interface ConfigBooleanControlProps {
  readonly definition: BooleanDefinition;
  readonly label: string;
  readonly value: boolean;
  readonly onChange: (value: boolean) => void;
}

export function ConfigBooleanControl({ definition, label, value, onChange }: ConfigBooleanControlProps) {
  return (
    <label className="settings-checkbox-control" data-setting={definition.key}>
      <input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />
      <span aria-hidden="true" />
      <strong>{label}</strong>
    </label>
  );
}
