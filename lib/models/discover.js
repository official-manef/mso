// Discover which models a custom endpoint actually serves.
// The owner knows a base URL and an API key but not the model ids; this asks the
// endpoint's own list API so the picker is never empty. Runtime-only, bounded, and
// credential-safe: the key is sent to the endpoint's pinned host, never returned,
// logged, or placed on a process argv.

const MAX_MODELS = 500
const MAX_BODY_BYTES = 2 * 1024 * 1024

/** List endpoint for a protocol. Anthropic keys live under /v1/models; an
 * OpenAI-compatible base already carries its own version segment. */
export function modelsEndpoint(baseUrl, protocol) {
  const base = String(baseUrl || '').replace(/\/+$/, '')
  if (protocol === 'anthropic') return /\/v\d+$/.test(base) ? `${base}/models` : `${base}/v1/models`
  return `${base}/models`
}

export function modelDiscoveryHeaders(protocol, apiKey) {
  if (protocol === 'anthropic') {
    return { accept: 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
  }
  return { accept: 'application/json', authorization: `Bearer ${apiKey}` }
}

function collect(value, out) {
  if (typeof value === 'string') {
    const id = value.trim()
    if (id) out.set(id, id)
    return
  }
  if (Array.isArray(value)) {
    for (const row of value) collect(row, out)
    return
  }
  if (!value || typeof value !== 'object') return
  const id = value.id ?? value.name ?? value.model
  if (typeof id === 'string' && id.trim()) {
    const named = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : id.trim()
    out.set(id.trim(), named)
  }
}

/** Tolerant parse of the common list shapes: `{data:[{id}]}`, `{models:[…]}`,
 * `{result:[…]}`, or a bare array of ids/objects. Deduped, sorted, bounded. */
export function parseDiscoveredModels(payload) {
  const out = new Map()
  if (Array.isArray(payload)) collect(payload, out)
  else if (payload && typeof payload === 'object') {
    for (const key of ['data', 'models', 'result']) if (key in payload) { collect(payload[key], out); break }
  }
  return [...out.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, MAX_MODELS)
}

async function readBounded(response) {
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_BODY_BYTES) throw new Error('model list response exceeds size limit')
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel('model list response exceeded size limit').catch(() => {})
        throw new Error('model list response exceeds size limit')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), bytes).toString('utf8')
}

/**
 * @param {{baseUrl:string, apiKey:string, protocol?:'openai'|'anthropic'}} conn
 * @param {{fetchImpl?:typeof fetch, timeoutMs?:number}} [options]
 * @returns {Promise<{id:string, name:string}[]>}
 */
export async function discoverEndpointModels({ baseUrl, apiKey, protocol = 'openai' }, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const signal = AbortSignal.timeout(timeoutMs)
  const response = await fetchImpl(modelsEndpoint(baseUrl, protocol), {
    method: 'GET',
    headers: modelDiscoveryHeaders(protocol, apiKey),
    redirect: 'error',
    signal,
  })
  if (!response.ok) {
    const detail = await readBounded(response).catch(() => '')
    throw new Error(`model discovery HTTP ${response.status}${detail ? `: ${detail.slice(0, 140)}` : ''}`)
  }
  const text = await readBounded(response)
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('model discovery returned invalid JSON')
  }
  return parseDiscoveredModels(payload)
}
