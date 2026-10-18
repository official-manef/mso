export type ProbeFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type ProbeResponse = {
  httpStatus?: number;
  data: Record<string, unknown> | null;
  challenge: string;
  issue?: "network" | "timeout" | "invalid-json" | "redirect" | "too-large";
};
export type ProbeRequestOptions = { fetcher: ProbeFetcher; signal?: AbortSignal; timeoutMs: number };

export function probeRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

const MAX_PROBE_BYTES = 64 * 1024;
class ProbeBodyTooLarge extends Error {}

async function readProbeJson(response: Response, signal: AbortSignal) {
  if (Number(response.headers.get("content-length")) > MAX_PROBE_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new ProbeBodyTooLarge();
  }
  if (!response.body) return null;
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  let bytes = 0, text = "";
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_PROBE_BYTES) { cancel(); throw new ProbeBodyTooLarge(); }
      text += decoder.decode(value, { stream: true });
    }
    return probeRecord(JSON.parse(text + decoder.decode()));
  } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}

export function requestMcpProbe(url: string, init: RequestInit, options: ProbeRequestOptions): Promise<ProbeResponse> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let complete = false;
    let httpStatus: number | undefined;
    const empty = (): ProbeResponse => ({ httpStatus, data: null, challenge: "" });
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
    };
    const finish = (value: ProbeResponse) => {
      if (complete) return;
      complete = true;
      cleanup();
      resolve(value);
    };
    const cancel = () => {
      if (complete) return;
      complete = true;
      cleanup();
      controller.abort(options.signal?.reason);
      reject(options.signal?.reason ?? new DOMException("Probe cancelled", "AbortError"));
    };
    if (options.signal?.aborted) { cancel(); return; }
    options.signal?.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(() => {
      finish({ ...empty(), issue: "timeout" });
      controller.abort(new DOMException("Probe timed out", "TimeoutError"));
    }, options.timeoutMs);

    void (async () => {
      const response = await options.fetcher(url, {
        ...init, cache: "no-store", credentials: "omit", redirect: "error", signal: controller.signal,
      });
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); return; }
      httpStatus = response.status;
      if (response.redirected) { void response.body?.cancel().catch(() => {}); return finish({ ...empty(), issue: "redirect" }); }
      const result = { httpStatus, data: null, challenge: response.headers.get("www-authenticate") ?? "" };
      if (!response.ok || init.method === "POST") { void response.body?.cancel().catch(() => {}); return finish(result); }
      try {
        const data = await readProbeJson(response, controller.signal);
        finish(data ? { ...result, data } : { ...result, issue: "invalid-json" });
      } catch (error) { finish({ ...result, issue: error instanceof ProbeBodyTooLarge ? "too-large" : "invalid-json" }); }
    })().catch(() => finish({ ...empty(), issue: "network" }));
  });
}
