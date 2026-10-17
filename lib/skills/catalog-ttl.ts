import { catalogSkillsDetailed, type SkillCatalog } from "./catalog";

export const DEFAULT_CATALOG_TTL_MS = 15_000;

export type CatalogTtlOptions<T = SkillCatalog> = {
  load?: () => Promise<T>;
  now?: () => number;
  ttlMs?: number;
};

export type CatalogTtl<T = SkillCatalog> = {
  get: (opts?: { refresh?: boolean }) => Promise<T>;
  invalidate: () => void;
};

export function createCatalogTtl<T = SkillCatalog>(
  options: CatalogTtlOptions<T> = {}
): CatalogTtl<T> {
  const load = options.load ?? (catalogSkillsDetailed as unknown as () => Promise<T>);
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_CATALOG_TTL_MS;

  let cached: { data: T; expiresAt: number } | null = null;
  let inFlight: Promise<T> | null = null;
  let currentRequestId = 0;

  const fetchFresh = (): Promise<T> => {
    const reqId = ++currentRequestId;
    const p = Promise.resolve()
      .then(() => load())
      .then((data) => {
        if (reqId === currentRequestId) {
          cached = { data, expiresAt: now() + ttlMs };
        }
        return data;
      })
      .finally(() => {
        if (reqId === currentRequestId) {
          inFlight = null;
        }
      });
    inFlight = p;
    return p;
  };

  return {
    async get(opts?: { refresh?: boolean }): Promise<T> {
      if (opts?.refresh) {
        cached = null;
        inFlight = null;
        return fetchFresh();
      }
      const currentTime = now();
      if (cached && currentTime < cached.expiresAt) {
        return cached.data;
      }
      if (inFlight) {
        return inFlight;
      }
      return fetchFresh();
    },
    invalidate(): void {
      cached = null;
      inFlight = null;
      currentRequestId++;
    },
  };
}

export const catalogTtl = createCatalogTtl();
