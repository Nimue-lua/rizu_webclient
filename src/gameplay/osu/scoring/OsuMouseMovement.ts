interface Point {
  readonly x: number;
  readonly y: number;
}

export interface OsuMouseMovement {
  readonly edge_distance: number;
  readonly velocity: number;
  readonly awkwardness: number;
  readonly turn_difficulty: number;
}

/** Tracks the minimum cursor movement needed to reach each hit area. */
export class OsuMouseMovementSimulator {
  readonly radius: number;
  velocity = 0;

  private previous_direction: Point | null = null;

  constructor(circle_size: number) {
    const finite_circle_size = Number.isFinite(circle_size) ? circle_size : 5;
    this.radius = Math.max(0, 54.4 - 4.48 * finite_circle_size);
  }

  move(from: Point, to: Point, delta_ms: number): OsuMouseMovement {
    const x = to.x - from.x;
    const y = to.y - from.y;
    const center_distance = Math.hypot(x, y);
    const edge_distance = Math.max(0, center_distance - this.radius * 2);
    this.velocity = delta_ms > 0 ? edge_distance / delta_ms : 0;

    let right_angle = 0;
    let reversal = 0;
    if (edge_distance > 0 && this.previous_direction) {
      const cosine = Math.max(-1, Math.min(1,
        (this.previous_direction.x * x + this.previous_direction.y * y) / center_distance));
      const angle = Math.acos(cosine);
      right_angle = Math.max(0, 1 - Math.abs(angle - Math.PI / 2) / (Math.PI / 2));
      reversal = Math.max(0, (angle - Math.PI * 0.75) / (Math.PI * 0.25));
    }
    if (edge_distance > 0) this.previous_direction = { x: x / center_distance, y: y / center_distance };

    return {
      edge_distance,
      velocity: this.velocity,
      awkwardness: 1 + right_angle * 0.2 + reversal * 0.4,
      turn_difficulty: right_angle * 1.5 + reversal * 2,
    };
  }

  sliderVelocity(pixel_length: number, span_duration_ms: number): number {
    const required_distance = Math.max(0, pixel_length - this.radius * 3);
    return span_duration_ms > 0 ? required_distance / span_duration_ms : 0;
  }
}
