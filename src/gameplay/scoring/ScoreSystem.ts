export interface ScoreSystem<Event> {
  readonly key: string;
  receive(event: Event): void;
}
