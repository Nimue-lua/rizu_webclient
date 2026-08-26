import {
  ArrowUpDown,
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  File,
  Globe2,
  Keyboard,
  ListFilter,
  Metronome,
  Monitor,
  Music2,
  Paintbrush,
  Play,
  Puzzle,
  Search,
  Settings,
  Terminal,
  Trophy,
  Undo2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { Chartview } from "../../library/views";
import type { ChartSortMode } from "../../select/ChartSelector";

type IconName = "arrow-up-down" | "bell" | "chevron-down" | "chevron-left" |
  "chevron-right" | "clock" | "download" | "file" | "filter" | "globe" | "keyboard" |
  "metronome" | "monitor" | "music" | "paintbrush" | "play" | "puzzle" | "search" |
  "settings" | "terminal" | "trophy" | "undo" | "zap";

const icons: Record<IconName, LucideIcon> = {
  "arrow-up-down": ArrowUpDown,
  bell: Bell,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  clock: Clock3,
  download: Download,
  file: File,
  filter: ListFilter,
  globe: Globe2,
  keyboard: Keyboard,
  metronome: Metronome,
  monitor: Monitor,
  music: Music2,
  paintbrush: Paintbrush,
  play: Play,
  puzzle: Puzzle,
  search: Search,
  settings: Settings,
  terminal: Terminal,
  trophy: Trophy,
  undo: Undo2,
  zap: Zap,
};

export const mode_names = ["OSU!", "TAIKO", "FRUITS", "MANIA"] as const;

export const sort_names: Record<ChartSortMode, string> = {
  title: "Title",
  artist: "Artist",
  difficulty: "Difficulty",
  duration: "Duration",
};

export function SongSelectIcon({ name }: { name: IconName }) {
  const Component = icons[name];
  return <Component aria-hidden="true" />;
}

export function chartMode(chart: Chartview): string {
  const mode = mode_names[chart.mode] ?? "UNKNOWN";
  return chart.mode === 3 && chart.keys !== null ? `${chart.keys}K ${mode}` : mode;
}

export function chartSummaryMode(chart: Chartview): string {
  return chart.mode === 3 && chart.keys !== null ? `${chart.keys}K` : mode_names[chart.mode] ?? "UNKNOWN";
}

export function difficultyColor(difficulty: number): string {
  const hue = Math.max(0, 135 - difficulty * 18);
  return `hsl(${hue} 92% 52%)`;
}

export function formatDuration(duration_seconds: number): string {
  const seconds = Math.round(duration_seconds);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
