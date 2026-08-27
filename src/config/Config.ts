export interface ConfigStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ConfigSetting<T> {
  readonly key: string;
  readonly default: T;
  readonly isValid: (value: unknown) => value is T;
}

export interface NumberDefinition extends ConfigSetting<number> {
  readonly kind: "number";
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export interface ChoiceDefinition<T extends string> extends ConfigSetting<T> {
  readonly kind: "choice";
  readonly choices: readonly T[];
}

export interface BooleanDefinition extends ConfigSetting<boolean> {
  readonly kind: "boolean";
}

export interface StringDefinition extends ConfigSetting<string> {
  readonly kind: "string";
}

export type ConfigDefinition =
  | NumberDefinition
  | ChoiceDefinition<string>
  | BooleanDefinition
  | StringDefinition;

export function numberSetting(key: string, default_value: number, min: number, max: number,
  step: number): NumberDefinition {
  if (!key || !Number.isFinite(default_value) || !Number.isFinite(min) || !Number.isFinite(max)
    || !Number.isFinite(step) || min > max || step <= 0 || default_value < min || default_value > max) {
    throw new Error(`Invalid number setting definition: ${key}`);
  }
  return {
    kind: "number", key, default: default_value, min, max, step,
    isValid: (value): value is number => typeof value === "number" && Number.isFinite(value)
      && value >= min && value <= max,
  };
}

export function choiceSetting<const T extends string>(key: string, default_value: T,
  choices: readonly T[]): ChoiceDefinition<T> {
  if (!key || choices.length === 0 || !choices.includes(default_value)) {
    throw new Error(`Invalid choice setting definition: ${key}`);
  }
  return {
    kind: "choice", key, default: default_value, choices,
    isValid: (value): value is T => typeof value === "string" && choices.includes(value as T),
  };
}

export function booleanSetting(key: string, default_value: boolean): BooleanDefinition {
  if (!key) throw new Error("A setting key cannot be empty");
  return { kind: "boolean", key, default: default_value, isValid: (value): value is boolean => typeof value === "boolean" };
}

export function stringSetting(key: string, default_value: string): StringDefinition {
  if (!key) throw new Error("A setting key cannot be empty");
  return { kind: "string", key, default: default_value, isValid: (value): value is string => typeof value === "string" };
}

interface PersistedConfig {
  version: 1;
  values: Record<string, unknown>;
}

type Listener = () => void;

export class Config {
  private readonly definitions = new Map<string, ConfigDefinition>();
  private readonly values = new Map<string, unknown>();
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(private readonly storage_key: string, definitions: readonly ConfigDefinition[],
    private readonly storage?: ConfigStorage) {
    for (const definition of definitions) {
      if (this.definitions.has(definition.key)) throw new Error(`Duplicate setting definition: ${definition.key}`);
      this.definitions.set(definition.key, definition);
    }
  }

  get<T>(definition: ConfigSetting<T>): T {
    this.assertRegistered(definition);
    return (this.values.get(definition.key) ?? definition.default) as T;
  }

  set<T>(definition: ConfigSetting<T>, value: T): void {
    this.assertRegistered(definition);
    if (!definition.isValid(value)) throw new Error(`Invalid value for setting: ${definition.key}`);
    if (Object.is(this.get(definition), value)) return;
    if (Object.is(definition.default, value)) this.values.delete(definition.key);
    else this.values.set(definition.key, value);
    this.persist();
    for (const listener of [...this.listeners.get(definition.key) ?? []]) listener();
  }

  subscribe<T>(definition: ConfigSetting<T>, listener: Listener): () => void {
    this.assertRegistered(definition);
    const listeners = this.listeners.get(definition.key) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(definition.key, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(definition.key);
    };
  }

  load(): boolean {
    const serialized = this.safeRead(this.storage_key);
    if (serialized === null) return false;
    try {
      const document: unknown = JSON.parse(serialized);
      if (!isRecord(document) || document.version !== 1 || !isRecord(document.values)) return false;
      const next_values = new Map<string, unknown>();
      for (const [key, value] of Object.entries(document.values)) {
        const definition = this.definitions.get(key);
        if (definition && !definition.isValid(value)) return false;
        if (definition && !Object.is(value, definition.default)) next_values.set(key, value);
      }
      this.values.clear();
      for (const [key, value] of next_values) this.values.set(key, value);
      return true;
    } catch {
      return false;
    }
  }

  import(values: Readonly<Record<string, unknown>>): boolean {
    for (const [key, value] of Object.entries(values)) {
      const definition = this.definitions.get(key);
      if (definition?.isValid(value) && !Object.is(value, definition.default)) this.values.set(key, value);
    }
    return this.persist();
  }

  private assertRegistered<T>(definition: ConfigSetting<T>): void {
    if ((this.definitions.get(definition.key) as ConfigSetting<unknown> | undefined) !== definition) {
      throw new Error(`Unknown setting: ${definition.key}`);
    }
  }

  private persist(): boolean {
    const document: PersistedConfig = { version: 1, values: Object.fromEntries(this.values) };
    try {
      if (!this.storage) return false;
      this.storage.setItem(this.storage_key, JSON.stringify(document));
      return true;
    } catch {
      // The in-memory store remains usable when browser storage is blocked or full.
      return false;
    }
  }

  private safeRead(key: string): string | null {
    try {
      return this.storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
