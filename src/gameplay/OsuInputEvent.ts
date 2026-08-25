export type OsuAction = "primary" | "secondary";

export interface OsuCursorState {
  readonly position: { readonly x: number; readonly y: number };
  readonly primary: boolean;
  readonly secondary: boolean;
}

export type OsuInputEvent = {
  readonly type: "aim";
  readonly time: number;
  readonly x: number;
  readonly y: number;
} | {
  readonly type: "action";
  readonly time: number;
  readonly action: OsuAction;
  readonly pressed: boolean;
};
