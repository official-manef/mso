import type { InfraProviderValues } from "./types";
import { readInfraProvider } from "./store";
import { request } from "./http";

const API = "https://backend.composio.dev/api/v3.1";

/**
 * Composio has four key kinds and each needs its own header. Project and scoped
 * project keys use x-api-key; organization keys use x-org-api-key; a user key
 * (uak_..., written by `composio login`) uses x-user-api-key. Sending a user key
 * as x-api-key is rejected with 401, which used to make every save fail.
 */
export function composioAuthHeader(values: InfraProviderValues): { header: Record<string, string>; kind: "organization" | "user" | "project" } | null {
  const orgKey = values.orgApiKey?.trim();
  if (orgKey) return { header: { "x-org-api-key": orgKey }, kind: "organization" };
  const key = values.apiKey?.trim();
  if (!key) return null;
  if (key.startsWith("uak_")) return { header: { "x-user-api-key": key }, kind: "user" };
  return { header: { "x-api-key": key }, kind: "project" };
}

export async function doctorComposio(candidate?: InfraProviderValues): Promise<string | null> {
  const values = candidate ?? await readInfraProvider("composio");
  const auth = composioAuthHeader(values);
  if (!auth) return null;
  // Session-info proves the key kind and works for all three kinds; tool listing
  // additionally proves project reach for keys that carry it.
  const target = auth.kind === "organization" ? "/org/owner/project/list" : auth.kind === "user" ? "/auth/session/info" : "/tools?limit=1";
  const response = await request(`${API}${target}`, { headers: auth.header });
  if (response.status === 401 || response.status === 403) {
    throw new Error(`Composio rejected this ${auth.kind} key (${response.status})`);
  }
  if (!response.ok) throw new Error(`Composio validation failed (${response.status})`);
  return auth.kind === "organization"
    ? "Composio organization key accepted"
    : auth.kind === "user"
      ? "Composio user key accepted"
      : "Composio project key accepted";
}
