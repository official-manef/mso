"use server";

import { requireSession } from "@/lib/auth/require-session";
import { headers } from "next/headers";
import { getClient, ensureClient, isAutoRegisterableClientId, storeCode, CODE_TTL_MS } from "@/lib/mcp/store";
import type { McpToolProfile } from "@/lib/mcp/tool-contract";
import { randomToken, isAllowedRedirect } from "@/lib/mcp/pkce";
import { parseScope, clampScope, mcpEnabled, type Scope } from "@/lib/mcp/scope";

export type ApprovalResult =
  | { ok: false; error: string }
  | { ok: true; redirectTo: string };

// The consent decision remains a Server Action so the signed-in mutation is
// same-origin by construction. Return the validated callback URL to the client and
// let the browser perform an explicit TOP-LEVEL navigation. `redirect()` inside a
// nested client action is transported over a fetch; the callback can complete and
// mint a token while the visible MSO tab stays put, which is exactly what the owner
// observed with ChatGPT.
export async function approve(form: FormData): Promise<ApprovalResult> {
  if (!mcpEnabled()) return { ok: false, error: "MCP is disabled on this server." };
  // The session cookie is the ONLY thing authorizing this. Re-checked here and not
  // inherited from the page render — a page can be cached, an action cannot.
  if (!(await requireSession("owner"))) return { ok: false, error: "Not signed in." };

  const clientId = String(form.get("client_id") ?? "");
  const redirectUri = String(form.get("redirect_uri") ?? "");
  const challenge = String(form.get("code_challenge") ?? "");
  const method = String(form.get("code_challenge_method") ?? "");
  const state = String(form.get("state") ?? "");
  const resource = String(form.get("resource") ?? "");
  const issuer = String(form.get("issuer") ?? "");
  const offlineAccess = String(form.get("offline_access") ?? "") === "1";
  const scope: Scope = clampScope(parseScope(String(form.get("scope") ?? "read")));

  if (method !== "S256" || !challenge) return { ok: false, error: "This client did not use PKCE S256, which mso requires." };
  if (!isAllowedRedirect(redirectUri)) return { ok: false, error: "The redirect target is not https (or localhost)." };
  const configured = process.env.OS_PUBLIC_ORIGIN?.trim();
  let expectedIssuer = "";
  if (configured) { try { expectedIssuer = new URL(configured).origin; } catch {} }
  if (!expectedIssuer) {
    const h = await headers();
    const forwardedHost = h.get("x-forwarded-host")?.split(",")[0].trim();
    const host = forwardedHost || h.get("host")?.trim() || "";
    const isLoopback = host.startsWith("localhost") || host.startsWith("127.") || host.startsWith("[::1]");
    const proto = h.get("x-forwarded-proto")?.split(",")[0].trim() || (isLoopback ? "http" : "https");
    try { expectedIssuer = new URL(`${proto}://${host}`).origin; } catch {}
  }
  if (!expectedIssuer || issuer !== expectedIssuer || resource !== `${expectedIssuer}/mcp`) return { ok: false, error: "OAuth resource/issuer mismatch." };

  const client = await getClient(clientId);
  // An unknown but valid public client id is registered on demand here too: the
  // consent page already offered Allow for it (inert until this approval), and
  // ChatGPT's user-defined client caches its id across connects. Reserved MSO
  // principals and malformed ids still fail closed.
  if (!client && !isAutoRegisterableClientId(clientId)) {
    return { ok: false, error: "This client must register before requesting authorization." };
  }
  if (!client) {
    await ensureClient(clientId, [redirectUri]);
    return approveRegistered({ clientId, redirectUri, challenge, state, scope, resource, issuer, offlineAccess, profile: "full" });
  }
  if (!client.redirectUris.includes(redirectUri)) {
    return { ok: false, error: "That redirect target is not registered for this client." };
  }

  return approveRegistered({ clientId, redirectUri, challenge, state, scope, resource, issuer, offlineAccess, profile: client.profile });
}

async function approveRegistered(input: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
  scope: Scope;
  resource: string;
  issuer: string;
  offlineAccess: boolean;
  profile?: McpToolProfile;
}): Promise<ApprovalResult> {
  const code = randomToken("mso_code_");
  await storeCode(code, {
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    codeChallenge: input.challenge,
    scope: input.scope,
    resource: input.resource,
    profile: input.profile,
    offlineAccess: input.offlineAccess,
    expiresAt: Date.now() + CODE_TTL_MS,
  });

  const dest = new URL(input.redirectUri);
  dest.searchParams.set("code", code);
  if (input.state) dest.searchParams.set("state", input.state);
  dest.searchParams.set("iss", input.issuer);
  return { ok: true, redirectTo: dest.toString() };
}
