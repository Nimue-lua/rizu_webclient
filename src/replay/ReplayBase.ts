export interface Modifier {
  id: number;
  version: number;
  value?: number | string;
}

export interface CommonReplayBaseValues {
  modifiers: Modifier[];
  rate: number;
  custom: boolean;
  rate_type: "linear" | "exp";
}
