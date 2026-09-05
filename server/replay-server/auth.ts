import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import type { JsonObject, UserRow } from "./types.ts";

const scryptAsync = promisify(scrypt);
const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function passwordHash(password: string, salt = randomBytes(16)): Promise<string> {
  const hash = await scryptAsync(password, salt, 32) as Buffer;
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  const [salt_hex, expected_hex] = parts[0] === "scrypt" ? parts.slice(1) : parts;
  if (!salt_hex || !expected_hex || !/^[a-f\d]+$/i.test(salt_hex) || !/^[a-f\d]+$/i.test(expected_hex)) return false;
  const expected = Buffer.from(expected_hex, "hex");
  const actual = await scryptAsync(password, Buffer.from(salt_hex, "hex"), expected.length) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function credentials(payload: JsonObject): { name: string; password: string } {
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  if (name.length < 2 || name.length > 24) throw Object.assign(new Error("Name must contain between 2 and 24 characters"), { status: 400 });
  if (password.length < 6 || password.length > 200) throw Object.assign(new Error("Password must contain between 6 and 200 characters"), { status: 400 });
  return { name, password };
}

export function authenticatedUser(database: DatabaseSync, request: IncomingMessage): UserRow | null {
  const match = request.headers.authorization?.match(/^Bearer (\S+)$/);
  if (!match) return null;
  return database.prepare(`
    SELECT users.id, users.name FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(tokenHash(match[1]), Math.floor(Date.now() / 1000)) as unknown as UserRow | undefined ?? null;
}

export function createSession(database: DatabaseSync, user_id: number): string {
  const token = randomBytes(32).toString("base64url");
  database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Math.floor(Date.now() / 1000));
  database.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(
    tokenHash(token), user_id, Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS,
  );
  return token;
}
