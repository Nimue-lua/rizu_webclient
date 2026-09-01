export interface GameplayPerformanceSample {
  readonly timestamp: number;
  readonly update_ms: number;
  readonly draw_ms: number;
  readonly visible_objects: number;
}

export class GameplayPerformanceGraph {
  private static readonly HISTORY_SIZE = 720;
  private static readonly STATS_SIZE = 60_000;
  private static readonly FRAME_BUCKETS = 65_536;
  private static readonly LABEL_INTERVAL_MS = 500;
  private readonly frame_ms = new Float32Array(GameplayPerformanceGraph.HISTORY_SIZE);
  private readonly update_ms = new Float32Array(GameplayPerformanceGraph.HISTORY_SIZE);
  private readonly draw_ms = new Float32Array(GameplayPerformanceGraph.HISTORY_SIZE);
  private readonly heap_bytes = new Float64Array(GameplayPerformanceGraph.HISTORY_SIZE);
  private readonly frame_bucket_history = new Uint16Array(GameplayPerformanceGraph.STATS_SIZE);
  private readonly frame_bucket_counts = new Uint32Array(GameplayPerformanceGraph.FRAME_BUCKETS);
  private write_index = 0;
  private sample_count = 0;
  private stats_write_index = 0;
  private stats_sample_count = 0;
  private previous_timestamp: number | null = null;
  private visible_objects = 0;
  private next_label_update = Number.NEGATIVE_INFINITY;
  private label_fps = "--";
  private label_frame = "0.00";
  private label_update = "0.00";
  private label_draw = "0.00";
  private label_cpu = "0.00";
  private label_low_point_one = "--";
  private label_low_point_zero_one = "--";
  private label_heap = "";
  private label_visible_objects = 0;
  private update_total = 0;
  private draw_total = 0;
  private timing_sample_count = 0;

  constructor(private readonly canvas: HTMLCanvasElement,
    private readonly device_pixel_ratio: () => number = () => window.devicePixelRatio) {}

  push(sample: GameplayPerformanceSample): void {
    const index = this.write_index;
    const frame_ms = this.previous_timestamp === null ? 0 : sample.timestamp - this.previous_timestamp;
    this.frame_ms[index] = frame_ms;
    this.update_ms[index] = sample.update_ms;
    this.draw_ms[index] = sample.draw_ms;
    this.heap_bytes[index] = readHeapBytes();
    this.visible_objects = sample.visible_objects;
    this.update_total += sample.update_ms;
    this.draw_total += sample.draw_ms;
    this.timing_sample_count += 1;
    this.previous_timestamp = sample.timestamp;
    this.write_index = (index + 1) % GameplayPerformanceGraph.HISTORY_SIZE;
    this.sample_count = Math.min(this.sample_count + 1, GameplayPerformanceGraph.HISTORY_SIZE);
    if (frame_ms > 0) this.pushFrameBucket(frame_ms);
    if (sample.timestamp >= this.next_label_update) {
      this.updateLabels(frame_ms, this.heap_bytes[index]!);
      this.next_label_update = sample.timestamp + GameplayPerformanceGraph.LABEL_INTERVAL_MS;
    }
    this.draw();
  }

  private draw(): void {
    const ratio = Math.max(1, this.device_pixel_ratio());
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const context = this.canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const logical_width = width / ratio;
    const logical_height = height / ratio;
    context.clearRect(0, 0, logical_width, logical_height);
    if (this.sample_count < 2) return;

    const graph_top = 42;
    const graph_bottom = logical_height - 18;
    const graph_height = Math.max(1, graph_bottom - graph_top);
    const max_ms = 50;
    context.fillStyle = "rgba(0, 0, 0, 0.25)";
    context.fillRect(0, 0, logical_width, logical_height);
    context.font = "12px ui-monospace, SFMono-Regular, Consolas, monospace";
    context.textBaseline = "top";
    this.drawBudget(context, logical_width, graph_top, graph_height, max_ms, 1000 / 120, "120", "rgba(100, 220, 255, 0.35)");
    this.drawBudget(context, logical_width, graph_top, graph_height, max_ms, 1000 / 60, "60", "rgba(100, 255, 150, 0.5)");
    this.drawBudget(context, logical_width, graph_top, graph_height, max_ms, 1000 / 30, "30", "rgba(255, 120, 100, 0.5)");
    this.drawHeapDrops(context, logical_width, graph_top, graph_bottom);
    this.drawTrace(context, this.frame_ms, logical_width, graph_top, graph_height, max_ms, "#ffffff");
    this.drawCombinedTrace(context, logical_width, graph_top, graph_height, max_ms, "#f35cff");
    this.drawTrace(context, this.update_ms, logical_width, graph_top, graph_height, max_ms, "#44e5ff");
    this.drawTrace(context, this.draw_ms, logical_width, graph_top, graph_height, max_ms, "#ffb347");

    context.fillStyle = "rgba(0, 0, 0, 0.72)";
    context.fillRect(6, 6, Math.min(logical_width - 12, 790), 27);
    context.fillStyle = "#fff";
    context.fillText(`FPS ${this.label_fps}  frame ${this.label_frame}ms`, 12, 12);
    context.fillStyle = "#44e5ff";
    context.fillText(`update ${this.label_update}ms`, 178, 12);
    context.fillStyle = "#ffb347";
    context.fillText(`draw ${this.label_draw}ms`, 300, 12);
    context.fillStyle = "#f35cff";
    context.fillText(`CPU ${this.label_cpu}ms`, 402, 12);
    context.fillStyle = "#fff";
    context.fillText(`objects ${this.label_visible_objects}`, 510, 12);
    context.fillText(`0.1% low ${this.label_low_point_one}  0.01% low ${this.label_low_point_zero_one}`, 610, 12);
    if (this.label_heap) context.fillText(`JS heap ${this.label_heap} MiB`, 12, 27);
    context.fillStyle = "#bf79ff";
    context.fillText("purple bars: heap drops / likely GC", 178, 27);
  }

  private drawBudget(context: CanvasRenderingContext2D, width: number, top: number, height: number,
    max_ms: number, milliseconds: number, label: string, color: string): void {
    const y = top + height * Math.min(milliseconds / max_ms, 1);
    context.strokeStyle = color;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
    context.fillStyle = color;
    context.fillText(`${label} FPS`, 6, y + 2);
  }

  private drawTrace(context: CanvasRenderingContext2D, values: Float32Array, width: number,
    top: number, height: number, max_ms: number, color: string): void {
    context.strokeStyle = color;
    context.lineWidth = 1.25;
    context.beginPath();
    for (let offset = 0; offset < this.sample_count; offset += 1) {
      const index = (this.write_index - this.sample_count + offset + GameplayPerformanceGraph.HISTORY_SIZE) %
        GameplayPerformanceGraph.HISTORY_SIZE;
      const x = this.sample_count <= 1 ? 0 : offset / (this.sample_count - 1) * width;
      const y = top + height * Math.min(values[index]! / max_ms, 1);
      if (offset === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
  }

  private drawCombinedTrace(context: CanvasRenderingContext2D, width: number, top: number,
    height: number, max_ms: number, color: string): void {
    context.strokeStyle = color;
    context.lineWidth = 1.25;
    context.beginPath();
    for (let offset = 0; offset < this.sample_count; offset += 1) {
      const index = (this.write_index - this.sample_count + offset + GameplayPerformanceGraph.HISTORY_SIZE) %
        GameplayPerformanceGraph.HISTORY_SIZE;
      const x = offset / (this.sample_count - 1) * width;
      const y = top + height * Math.min((this.update_ms[index]! + this.draw_ms[index]!) / max_ms, 1);
      if (offset === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
  }

  private drawHeapDrops(context: CanvasRenderingContext2D, width: number, top: number, bottom: number): void {
    context.strokeStyle = "rgba(190, 100, 255, 0.55)";
    context.lineWidth = 1;
    for (let offset = 1; offset < this.sample_count; offset += 1) {
      const index = (this.write_index - this.sample_count + offset + GameplayPerformanceGraph.HISTORY_SIZE) %
        GameplayPerformanceGraph.HISTORY_SIZE;
      const previous = (index + GameplayPerformanceGraph.HISTORY_SIZE - 1) % GameplayPerformanceGraph.HISTORY_SIZE;
      if (this.heap_bytes[index]! <= 0 || this.heap_bytes[index]! >= this.heap_bytes[previous]!) continue;
      const x = offset / (this.sample_count - 1) * width;
      context.beginPath();
      context.moveTo(x, top);
      context.lineTo(x, bottom);
      context.stroke();
    }
  }

  private pushFrameBucket(frame_ms: number): void {
    const bucket = Math.min(GameplayPerformanceGraph.FRAME_BUCKETS - 1, Math.round(frame_ms * 10));
    if (this.stats_sample_count === GameplayPerformanceGraph.STATS_SIZE) {
      this.frame_bucket_counts[this.frame_bucket_history[this.stats_write_index]!]! -= 1;
    } else {
      this.stats_sample_count += 1;
    }
    this.frame_bucket_history[this.stats_write_index] = bucket;
    this.frame_bucket_counts[bucket]! += 1;
    this.stats_write_index = (this.stats_write_index + 1) % GameplayPerformanceGraph.STATS_SIZE;
  }

  private updateLabels(frame_ms: number, heap_bytes: number): void {
    const sample_count = Math.max(1, this.timing_sample_count);
    const update_ms = this.update_total / sample_count;
    const draw_ms = this.draw_total / sample_count;
    this.label_fps = frame_ms > 0 ? (1000 / frame_ms).toFixed(1) : "--";
    this.label_frame = frame_ms.toFixed(2);
    this.label_update = update_ms.toFixed(2);
    this.label_draw = draw_ms.toFixed(2);
    this.label_cpu = (update_ms + draw_ms).toFixed(2);
    this.label_low_point_one = this.lowFps(0.1);
    this.label_low_point_zero_one = this.lowFps(0.01);
    this.label_heap = heap_bytes > 0 ? (heap_bytes / (1024 * 1024)).toFixed(1) : "";
    this.label_visible_objects = this.visible_objects;
    this.update_total = 0;
    this.draw_total = 0;
    this.timing_sample_count = 0;
  }

  private lowFps(percent: number): string {
    let remaining = Math.max(1, Math.ceil(this.stats_sample_count * percent / 100));
    let frame_time_total = 0;
    const target_count = remaining;
    for (let bucket = GameplayPerformanceGraph.FRAME_BUCKETS - 1; bucket > 0 && remaining > 0; bucket -= 1) {
      const take = Math.min(remaining, this.frame_bucket_counts[bucket]!);
      frame_time_total += take * bucket / 10;
      remaining -= take;
    }
    if (remaining > 0 || frame_time_total <= 0) return "--";
    return (1000 / (frame_time_total / target_count)).toFixed(1);
  }
}

function readHeapBytes(): number {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
  return memory?.usedJSHeapSize ?? 0;
}
