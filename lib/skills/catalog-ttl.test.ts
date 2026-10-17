import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createCatalogTtl, catalogTtl, DEFAULT_CATALOG_TTL_MS } from "./catalog-ttl";
import type { SkillCatalog } from "./catalog";

vi.mock("@/lib/auth/require-session", () => ({ requireSession: vi.fn(async () => true) }));
vi.mock("@/lib/workflow", () => ({ listLearnedRecipes: vi.fn(async () => []) }));

const mockScanReport: SkillCatalog["scan"] = {
  truncated: true,
  truncationReasons: ["deadline", "maxProjects"],
  scannedRoots: 4,
  scannedProjects: 2,
  continuation: {
    pendingRoots: ["/repo/project-b"],
    cursors: [{ root: "/repo/project-a", entriesConsumed: 12 }],
    pendingProjects: 1,
    cursorSemantics: "readdir-position",
    note: "Pass cursor back to resume",
    cursor: "cursor-token-xyz",
  },
};

const mockCatalog: SkillCatalog = {
  skills: [{ id: "proj/task", name: "task", path: "/skills/task", description: "Sample", source: "project", trust: "untrusted" }],
  scan: mockScanReport,
};

describe("catalog-ttl memo", () => {
  it("one load within TTL, two loads after expiry", async () => {
    let clock = 1_000, loadCount = 0;
    const memo = createCatalogTtl({
      load: async () => { loadCount++; return mockCatalog; },
      now: () => clock,
      ttlMs: 15_000,
    });

    const first = await memo.get();
    expect(loadCount).toBe(1);
    expect(first).toBe(mockCatalog);

    clock = 5_000;
    const withinTtl = await memo.get();
    expect(loadCount).toBe(1);
    expect(withinTtl).toBe(mockCatalog);

    clock = 16_001;
    const firstAfterExpiry = await memo.get();
    expect(loadCount).toBe(2);
    expect(firstAfterExpiry).toBe(mockCatalog);

    clock = 20_000;
    await memo.get();
    expect(loadCount).toBe(2);

    clock = 32_000;
    const secondAfterExpiry = await memo.get();
    expect(loadCount).toBe(3);
    expect(secondAfterExpiry).toBe(mockCatalog);
  });

  it("scan and continuation fields pass through byte-identical", async () => {
    const memo = createCatalogTtl({ load: async () => mockCatalog, now: () => 1_000 });
    const result = await memo.get();
    expect(result).toBe(mockCatalog);
    expect(result.scan.truncated).toBe(true);
    expect(result.scan.truncationReasons).toEqual(["deadline", "maxProjects"]);
    expect(result.scan.continuation?.cursor).toBe("cursor-token-xyz");
    expect(result.scan.continuation?.cursorSemantics).toBe("readdir-position");
    expect(result.scan.continuation?.cursors).toEqual([{ root: "/repo/project-a", entriesConsumed: 12 }]);
    expect(result.scan.continuation?.pendingRoots).toEqual(["/repo/project-b"]);
  });

  it("refresh:true forces a reload", async () => {
    let clock = 1_000, loadCount = 0;
    const memo = createCatalogTtl({
      load: async () => { loadCount++; return mockCatalog; },
      now: () => clock,
      ttlMs: 15_000,
    });
    await memo.get();
    expect(loadCount).toBe(1);

    clock = 2_000;
    await memo.get({ refresh: true });
    expect(loadCount).toBe(2);
  });

  it("a rejected load is not cached", async () => {
    let fail = true, loadCount = 0;
    const memo = createCatalogTtl({
      load: async () => {
        loadCount++;
        if (fail) throw new Error("scan failed");
        return mockCatalog;
      },
      now: () => 1_000,
      ttlMs: 15_000,
    });

    await expect(memo.get()).rejects.toThrow("scan failed");
    expect(loadCount).toBe(1);

    fail = false;
    const recovered = await memo.get();
    expect(recovered).toBe(mockCatalog);
    expect(loadCount).toBe(2);
  });

  it("invalidate() clears cached state and in-flight", async () => {
    let loadCount = 0;
    const memo = createCatalogTtl({
      load: async () => { loadCount++; return mockCatalog; },
      now: () => 1_000,
      ttlMs: 15_000,
    });
    await memo.get();
    expect(loadCount).toBe(1);

    memo.invalidate();
    await memo.get();
    expect(loadCount).toBe(2);
  });

  it("coalesces concurrent in-flight requests", async () => {
    let loadCount = 0;
    const memo = createCatalogTtl({
      load: async () => {
        loadCount++;
        await new Promise((r) => setTimeout(r, 10));
        return mockCatalog;
      },
      now: () => 1_000,
    });

    const [a, b] = await Promise.all([memo.get(), memo.get()]);
    expect(loadCount).toBe(1);
    expect(a).toBe(mockCatalog);
    expect(b).toBe(mockCatalog);
  });

  it("default ttlMs is between 10000 and 30000", () => {
    expect(DEFAULT_CATALOG_TTL_MS).toBeGreaterThanOrEqual(10_000);
    expect(DEFAULT_CATALOG_TTL_MS).toBeLessThanOrEqual(30_000);
  });
});

describe("/api/skills route integration", () => {
  beforeEach(() => {
    catalogTtl.invalidate();
  });

  it("uses catalogTtl for list and forwards refresh flag", async () => {
    const { GET } = await import("@/app/api/skills/route");
    const getSpy = vi.spyOn(catalogTtl, "get").mockResolvedValue(mockCatalog);

    const res = await GET(new NextRequest("http://localhost/api/skills"));
    expect(res.status).toBe(200);
    expect(getSpy).toHaveBeenCalledWith({ refresh: false });

    await GET(new NextRequest("http://localhost/api/skills?refresh=1"));
    expect(getSpy).toHaveBeenCalledWith({ refresh: true });

    await GET(new NextRequest("http://localhost/api/skills?refresh=true"));
    expect(getSpy).toHaveBeenCalledWith({ refresh: true });

    getSpy.mockRestore();
  });

  it("bypasses catalogTtl when querying by name", async () => {
    const { GET } = await import("@/app/api/skills/route");
    const getSpy = vi.spyOn(catalogTtl, "get");

    await GET(new NextRequest("http://localhost/api/skills?name=nonexistent-skill"));
    expect(getSpy).not.toHaveBeenCalled();

    getSpy.mockRestore();
  });
});
