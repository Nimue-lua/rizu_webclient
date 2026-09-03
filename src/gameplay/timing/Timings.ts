export type TimingsName = "unknown" | "arbitrary" | "sphere" | "simple" | "osuod" |
  "etternaj" | "quaver" | "bmsrank" | "osu_std_od";

export interface TimingsValue {
  name: TimingsName;
  data: number;
}

function isInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value);
}

export class Timings implements TimingsValue {
  readonly name: TimingsName;
  readonly data: number;

  constructor(name: TimingsName, data = 0) {
    this.name = name;
    this.data = data;
    if (!this.isValid()) throw new Error(`Invalid timings: ${name} ${data}`);
    Object.freeze(this);
  }

  static decode(value: number): Timings {
    if (!isInteger(value)) throw new Error("Timings encoding must be an integer");
    if (value === 0) return new Timings("arbitrary");
    if (value === 100) return new Timings("sphere");
    if (value >= 1000 && value <= 2000) return new Timings("simple", (value - 1000) / 1000);
    if (value >= 2100 && value <= 2200) return new Timings("osuod", (value - 2100) / 10);
    if (value >= 2301 && value <= 2309) return new Timings("etternaj", value - 2300);
    if (value === 2400) return new Timings("quaver");
    if (value >= 2500 && value <= 2504) return new Timings("bmsrank", value - 2500);
    if (value >= 2600 && value <= 2720) return new Timings("osu_std_od", (value - 2600) / 10);
    return new Timings("unknown", value);
  }

  static fromValue(value: TimingsValue): Timings {
    return new Timings(value.name, value.data);
  }

  encode(): number {
    switch (this.name) {
      case "arbitrary": return 0;
      case "sphere": return 100;
      case "simple": return 1000 + this.data * 1000;
      case "osuod": return 2100 + this.data * 10;
      case "etternaj": return 2300 + this.data;
      case "quaver": return 2400;
      case "bmsrank": return 2500 + this.data;
      case "osu_std_od": return 2600 + this.data * 10;
      case "unknown": return this.data;
    }
  }

  equals(other: Timings): boolean {
    return this.name === other.name && this.data === other.data;
  }

  toJSON(): TimingsValue {
    return { name: this.name, data: this.data };
  }

  toString(): string {
    return `Timings(${this.name}, ${this.data})`;
  }

  private isValid(): boolean {
    switch (this.name) {
      case "arbitrary":
      case "sphere":
      case "quaver": return this.data === 0;
      case "simple": return this.data >= 0 && this.data <= 1 && isInteger(this.data * 1000);
      case "osuod": return this.data >= 0 && this.data <= 10 && isInteger(this.data * 10);
      case "osu_std_od": return this.data >= 0 && this.data <= 12 && isInteger(this.data * 10);
      case "etternaj": return isInteger(this.data) && this.data >= 1 && this.data <= 9;
      case "bmsrank": return isInteger(this.data) && this.data >= 0 && this.data <= 4;
      case "unknown": return isInteger(this.data);
    }
  }
}
