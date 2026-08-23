export class SpringValue {
  private velocity = 0;

  constructor(public value: number, private readonly frequency = 10) {}

  teleport(value: number): void {
    this.value = value;
    this.velocity = 0;
  }

  update(target: number, delta_time: number): number {
    const duration = Math.max(0, Math.min(delta_time, 0.1));
    const displacement = this.value - target;
    const decay = Math.exp(-this.frequency * duration);
    const velocity_term = this.velocity + this.frequency * displacement;
    this.value = target + (displacement + velocity_term * duration) * decay;
    this.velocity = (this.velocity - this.frequency * velocity_term * duration) * decay;
    return this.value;
  }
}
