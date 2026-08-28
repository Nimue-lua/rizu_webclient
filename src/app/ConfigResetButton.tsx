import { RotateCcw } from "lucide-react";

interface ConfigResetButtonProps {
  readonly label: string;
  readonly onReset: () => void;
}

export function ConfigResetButton({ label, onReset }: ConfigResetButtonProps) {
  return <button className="config-reset-button" type="button" aria-label={label} title={label} onClick={onReset}>
    <RotateCcw aria-hidden="true" />
  </button>;
}
