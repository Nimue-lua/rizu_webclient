import type { LogicEvent } from "../LogicEvent";

export interface ScoreSystem {
  readonly key: string;
  receive(event: LogicEvent): void;
}
