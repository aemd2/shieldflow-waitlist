import "server-only";
import { randomUUID } from "node:crypto";

/** Cryptographically-random ID for storage paths, OAuth state, etc. */
export function newUuid(): string {
  return randomUUID();
}
