import { isRemoteMcpOrigin, mcpEndpoints, type McpProbeCheck, type McpProbeCheckId, type McpProbeResult } from "./mcp-client-core";
import { requestMcpProbe, type ProbeFetcher, type ProbeResponse } from "./mcp-probe-request";

export type McpProbeOptions = {
  observedOrigin?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  expectedRuntimeInstanceId?: string | null;
};

function includesString(value: unknown, expected: string) {
  return Array.isArray(value) && value.every(item => typeof item === "string") && value.includes(expected);
}
function presentText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 160;
}
function makeCheck(id: McpProbeCheckId, state: McpProbeCheck["state"], detail: string, guidance?: string): McpProbeCheck {
  return { id, state, ok: state === "passed", detail, ...(guidance ? { guidance } : {}) };
}
function checkResponse(id: McpProbeCheckId, response: ProbeResponse, valid: boolean, detail: string, guidance: string): McpProbeCheck {
  const issue = response.issue === "timeout" ? "This check timed out."
    : response.issue === "network" ? "No response was received."
    : response.issue === "invalid-json" ? "The response is not a valid JSON object."
    : response.issue === "too-large" ? "The response exceeded the 64 KiB diagnostic limit."
    : response.issue === "redirect" ? "The endpoint redirected; its identity was not verified."
    : response.httpStatus !== undefined && response.httpStatus >= 400 ? "Received HTTP " + response.httpStatus + "."
    : "The response does not match this server's discovery contract.";
  return {
    ...makeCheck(id, valid && !response.issue ? "passed" : "failed", valid && !response.issue ? detail : issue,
      valid && !response.issue ? undefined : guidance),
    ...(response.httpStatus !== undefined ? { httpStatus: response.httpStatus } : {}),
  };
}

export async function probeMcpConnection(rawOrigin: string, fetcher: ProbeFetcher = fetch, options: McpProbeOptions = {}): Promise<McpProbeResult> {
  options.signal?.throwIfAborted();
  const endpoints = mcpEndpoints(rawOrigin);
  const observedOrigin = new URL(options.observedOrigin ?? endpoints.origin).origin;
  const timeoutMs = options.timeoutMs ?? 8_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid probe timeout");
  const request = (url: string, init: RequestInit = {}) => requestMcpProbe(url, init, { fetcher, signal: options.signal, timeoutMs });
  const responses = await Promise.all([
    request(endpoints.origin + "/api/health"),
    request(endpoints.mcp),
    request(endpoints.mcp, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "settings-probe", method: "initialize", params: {} }),
    }),
    request(endpoints.protectedResource),
    request(endpoints.authorizationServer),
  ]);
  options.signal?.throwIfAborted();
  const [server, descriptor, challenge, resource, oauth] = responses;
  const health = server.data, mcp = descriptor.data, resourceData = resource.data, oauthData = oauth.data;
  const serverOk = health?.status === "ok" && health.service === "mso" && presentText(health.version) && presentText(health.buildId);
  const targetChanged = serverOk && presentText(options.expectedRuntimeInstanceId) &&
    presentText(health?.runtimeInstanceId) && health.runtimeInstanceId !== options.expectedRuntimeInstanceId;
  const targetUnknown = serverOk && presentText(options.expectedRuntimeInstanceId) && !presentText(health?.runtimeInstanceId);
  const serverCheck = targetChanged || targetUnknown
    ? { ...makeCheck("server", targetChanged ? "failed" : "unknown",
      targetChanged ? "The runtime identity changed since Settings loaded." : "MSO responded, but its runtime identity could not be verified.",
      "Reload Settings and verify the server identity before continuing."), httpStatus: server.httpStatus }
    : checkResponse("server", server, serverOk, "MSO health responded at the observed origin.", "Check the MSO service, port, and gateway, then retry.");
  const metadata = challenge.challenge.match(/\bresource_metadata\s*=\s*"([^"]+)"/i);
  const discovery = [
    serverCheck,
    checkResponse("mcp", descriptor, mcp?.name === "mso MCP" && includesString(mcp.authorization_servers, endpoints.origin),
      "The MCP endpoint advertises the configured origin.", "Check that MCP is enabled on this host and the public origin is correct."),
    checkResponse("challenge", challenge, challenge.httpStatus === 401 && /^Bearer\s/i.test(challenge.challenge) && metadata?.[1] === endpoints.protectedResource,
      "Unauthenticated requests receive the expected OAuth challenge.", "Check that the proxy preserves the MCP response and WWW-Authenticate header."),
    checkResponse("resource", resource, resourceData?.resource === endpoints.mcp && includesString(resourceData.authorization_servers, endpoints.origin),
      "Protected-resource metadata identifies the configured MCP endpoint.", "Check the protected-resource metadata and configured public origin."),
    checkResponse("oauth", oauth, oauthData?.issuer === endpoints.origin &&
      oauthData.authorization_endpoint === endpoints.authorize && oauthData.token_endpoint === endpoints.token &&
      oauthData.registration_endpoint === endpoints.register && includesString(oauthData.code_challenge_methods_supported, "S256") &&
      includesString(oauthData.token_endpoint_auth_methods_supported, "none"),
      "OAuth endpoints and PKCE metadata match this server.", "Check the public origin and OAuth endpoints before reconnecting your AI app."),
  ];
  let https: McpProbeCheck;
  if (!isRemoteMcpOrigin(endpoints.origin)) {
    https = makeCheck("https", "unknown", "A public HTTPS connection has not been verified.",
      "Hosted AI apps need a reachable HTTPS URL. Check the connection mode below.");
  } else if (observedOrigin !== endpoints.origin) {
    https = makeCheck("https", "unknown", "These requests reached the observed origin, not the configured public origin.",
      "Open the configured HTTPS origin and run this check there.");
  } else if (responses.some(response => response.httpStatus !== undefined && response.issue !== "redirect")) {
    https = makeCheck("https", "passed", "This browser received an HTTPS response from the configured origin.");
  } else {
    https = makeCheck("https", "unknown", "No HTTPS response was observed.",
      "Open the configured URL and check its DNS, certificate, and gateway.");
  }
  return {
    ready: discovery.every(check => check.ok),
    observedOrigin, configuredOrigin: endpoints.origin, checkedAt: new Date().toISOString(),
    checks: [
      discovery[0], https, ...discovery.slice(1),
      makeCheck("account", "unknown", "MSO cannot observe the account selected inside your AI app.",
        "Select the intended account and MSO connection there. Connected apps shows access granted on this server."),
      makeCheck("client-tools", "unknown", "Server discovery does not reveal the tools cached by your AI app.",
        "Refresh or reconnect MSO in your AI app, then try a read-only tool. Tools & updates shows the server signature."),
    ],
  };
}
