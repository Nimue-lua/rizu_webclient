import type { ConfigStorage } from "../config/Config";
import { appSettings, settings } from "../config/Settings";

const TOKEN_KEY = "rizu.online.token";
const CLIENT_ID_KEY = "rizu.online.client_id";

export interface OnlineClientOptions {
  readonly serverAddress: () => string;
  readonly storage?: ConfigStorage;
  readonly request?: typeof fetch;
}

function browserStorage(): ConfigStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export class OnlineClient {
  private readonly account_listeners = new Set<() => void>();
  private readonly request_impl: typeof fetch;
  private readonly transient_client_id = crypto.randomUUID();

  constructor(private readonly options: OnlineClientOptions) {
    this.request_impl = options.request ?? ((input, init) => fetch(input, init));
  }

  readonly request: typeof fetch = (input, init) => {
    const target = typeof input === "string" ? this.resolveUrl(input) : input;
    return this.request_impl(target, init);
  };

  resolveUrl(path: string): string {
    const configured_address = this.options.serverAddress().trim();
    if (!configured_address) return path;

    const server_address = /^[a-z][a-z\d+.-]*:\/\//i.test(configured_address)
      ? configured_address
      : `http://${configured_address}`;
    try {
      const url = new URL(server_address);
      return `${url.toString().replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
    } catch {
      throw new Error(`Invalid online server address: ${configured_address}`);
    }
  }

  authorizationHeaders(): Record<string, string> {
    const token = this.options.storage?.getItem(this.tokenKey());
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  clientId(): string {
    try {
      const stored_id = this.options.storage?.getItem(CLIENT_ID_KEY);
      if (stored_id) return stored_id;
      this.options.storage?.setItem(CLIENT_ID_KEY, this.transient_client_id);
    } catch {
      // A session-only identity still provides correct presence when storage is unavailable.
    }
    return this.transient_client_id;
  }

  setToken(token: string): void {
    this.options.storage?.setItem(this.tokenKey(), token);
    this.notifyAccountChange();
  }

  clearToken(): void {
    this.options.storage?.removeItem(this.tokenKey());
    this.notifyAccountChange();
  }

  subscribeAccountChanges(listener: () => void): () => void {
    this.account_listeners.add(listener);
    return () => this.account_listeners.delete(listener);
  }

  notifyAccountChange(): void {
    for (const listener of this.account_listeners) listener();
  }

  private tokenKey(): string {
    const server_address = this.options.serverAddress().trim().replace(/\/$/, "");
    return server_address ? `${TOKEN_KEY}:${server_address}` : TOKEN_KEY;
  }
}

export const onlineClient = new OnlineClient({
  serverAddress: () => appSettings.get(settings.online_server_address),
  storage: browserStorage(),
});

appSettings.subscribe(settings.online_server_address, () => onlineClient.notifyAccountChange());
