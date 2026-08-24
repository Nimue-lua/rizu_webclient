export type SubtimingsName = "unknown" | "scorev";

export interface SubtimingsValue {
  name: SubtimingsName;
  data: number;
}

export class Subtimings implements SubtimingsValue {
  readonly name: SubtimingsName;
  readonly data: number;

  constructor(name: SubtimingsName, data: number) {
    this.name = name;
    this.data = data;
    if (!Number.isInteger(data) || (name === "scorev" ? data !== 1 && data !== 2 : name !== "unknown")) {
      throw new Error(`Invalid subtimings: ${name} ${data}`);
    }
    Object.freeze(this);
  }

  static decode(value: number): Subtimings {
    if (!Number.isInteger(value)) throw new Error("Subtimings encoding must be an integer");
    if (value === 1101 || value === 1102) return new Subtimings("scorev", value - 1100);
    return new Subtimings("unknown", value);
  }

  static fromValue(value: SubtimingsValue): Subtimings {
    return new Subtimings(value.name, value.data);
  }

  encode(): number {
    return this.name === "scorev" ? 1100 + this.data : this.data;
  }

  equals(other: Subtimings): boolean {
    return this.name === other.name && this.data === other.data;
  }

  toJSON(): SubtimingsValue {
    return { name: this.name, data: this.data };
  }

  toString(): string {
    return `Subtimings(${this.name}, ${this.data})`;
  }
}
