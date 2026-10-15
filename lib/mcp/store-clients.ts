import { randomUUID } from "node:crypto";
import { detectMcpToolProfile } from "./client-profile";
import { assertMcpClientCapacity, commitMcpStore as write, mutateMcpStore as mutate, readMcpStore as read, sweepMcpStore as sweep } from "./store-state";
import type { McpClient } from "./store-types";

// Registration, lookup and the on-demand compatibility seam. Split out of store.ts
// to keep both files inside the 220-line architecture ratchet; re-exported from
// store.ts so callers keep one import path.

export function registerClient(name: string, redirectUris: string[]): Promise<string> {
  return mutate(async () => {
    const store = sweep(await read());
    assertMcpClientCapacity(store);
    const clientId = "mcpc_" + randomUUID().replaceAll("-", "").slice(0, 24);
    const cleanName = name.slice(0, 80) || "MCP Client";
    store.clients[clientId] = {
      name: cleanName,
      redirectUris,
      profile: detectMcpToolProfile({ clientId, name: cleanName, redirectUris }),
      createdAt: Date.now(),
    };
    await write(store);
    return clientId;
  });
}

export async function getClient(clientId: string): Promise<McpClient | null> {
  const clients = sweep(await read()).clients;
  return Object.hasOwn(clients, clientId) ? clients[clientId] : null;
}

// MSO principals are server-owned. A request that names one of these is trying to
// alias an existing authority and must never be auto-registered.
const RESERVED_CLIENT_ID = /^(manual:|pat:|mso_)/;

/** A self-declared public client id that may be registered on demand. */
export function isAutoRegisterableClientId(clientId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(clientId) && !RESERVED_CLIENT_ID.test(clientId);
}

/**
 * Compatibility seam for OAuth clients that cache a client_id across connects
 * (ChatGPT's user-defined client is the motivating case). The MSO design kept
 * rejecting any id it had not minted itself, but `/oauth/register` is ALREADY a
 * public endpoint that mints a client for any https callback — so the rejection
 * added no security; it only broke clients whose registration had been swept.
 *
 * Idempotent: an existing client is returned with its redirect list unioned (a
 * reconnect may present a new callback). A new registration is server-side and
 * INERT until the owner approves it on the consent page and completes PKCE, and
 * reserved MSO principals are refused outright.
 */
export function ensureClient(clientId: string, redirectUris: string[], name?: string): Promise<McpClient> {
  return mutate(async () => {
    const store = sweep(await read());
    const existing = Object.hasOwn(store.clients, clientId) ? store.clients[clientId] : undefined;
    if (existing) {
      const merged = [...new Set([...existing.redirectUris, ...redirectUris])].slice(0, 8);
      if (merged.length !== existing.redirectUris.length) {
        store.clients[clientId] = { ...existing, redirectUris: merged };
        await write(store);
      }
      return store.clients[clientId];
    }
    if (!isAutoRegisterableClientId(clientId)) throw new Error("reserved MCP client id");
    assertMcpClientCapacity(store);
    const cleanName = (name ?? "").slice(0, 80) || "MCP Client";
    const uris = [...new Set(redirectUris)].slice(0, 8);
    store.clients[clientId] = {
      name: cleanName,
      redirectUris: uris,
      profile: detectMcpToolProfile({ clientId, name: cleanName, redirectUris: uris }),
      createdAt: Date.now(),
    };
    await write(store);
    return store.clients[clientId];
  });
}
