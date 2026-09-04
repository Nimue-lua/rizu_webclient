import type { OnlinePlayer, OnlineUser } from "../replay/ReplayServer";

export interface OnlineController {
  readonly user: OnlineUser | null;
  readonly count: number | null;
  readonly players: readonly OnlinePlayer[];
  readonly score: { id: number | null; state: "pending" | "ready" | "error" } | null;
}
