import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { READ_ONLY } from "./tool-kit";

vi.mock("server-only", () => ({}));
const { READ_TOOLS } = await import("./tools-read");

describe("sys_stats model contract", () => {
  it("returns uptime with explicit units and no ambiguous uptime field", async () => {
    const tool = READ_TOOLS.find((row) => row.name === "sys_stats");
    expect(tool?.description).toContain("uptimeMs");
    const result = await tool!.run({}, { scope: "read" }) as Record<string, unknown>;
    expect(result.uptime).toBeUndefined();
    expect(result.uptimeMs).toEqual(expect.any(Number));
    expect(result.uptimeSeconds).toEqual(expect.any(Number));
    expect(Number(result.uptimeMs)).toBeGreaterThan(Number(result.uptimeSeconds));
  });
});

describe("fs_stat read capability", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "mso-fs-stat-test-"));
    vi.stubEnv("OS_FS_READ_ROOTS", tempRoot);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("is listed at read scope with read-only annotations", () => {
    const tool = READ_TOOLS.find((row) => row.name === "fs_stat");
    expect(tool).toBeDefined();
    expect(tool?.scope).toBe("read");
    expect(tool?.annotations).toEqual(READ_ONLY);
    expect(tool?.description).toContain("true sizeBytes");
  });

  it("refuses credential paths", async () => {
    const tool = READ_TOOLS.find((row) => row.name === "fs_stat")!;
    await expect(tool.run({ path: path.join(tempRoot, ".env.local") }, { scope: "read" })).rejects.toThrow(/credential|sensitive/i);
    await expect(tool.run({ path: path.join(tempRoot, ".ssh", "id_rsa") }, { scope: "read" })).rejects.toThrow(/credential|sensitive/i);
  });

  it("is callable and returns true size for a temp file", async () => {
    const tool = READ_TOOLS.find((row) => row.name === "fs_stat")!;
    const filePath = path.join(tempRoot, "binary-sample.bin");
    const payload = Buffer.from("MSO-STAT-BOUNDED-TEST-PAYLOAD-12345");
    await writeFile(filePath, payload);

    const result = (await tool.run({ path: filePath }, { scope: "read" })) as Record<string, unknown>;
    expect(result).toEqual({
      kind: "file",
      sizeBytes: payload.byteLength,
      mtimeMs: expect.any(Number),
      ctimeMs: expect.any(Number),
      mode: expect.any(Number),
    });
  });

  it("returns kind 'dir' for a directory", async () => {
    const tool = READ_TOOLS.find((row) => row.name === "fs_stat")!;
    const dirPath = path.join(tempRoot, "nested-folder");
    await mkdir(dirPath);

    const result = (await tool.run({ path: dirPath }, { scope: "read" })) as Record<string, unknown>;
    expect(result.kind).toBe("dir");
    expect(result.sizeBytes).toEqual(expect.any(Number));
    expect(result.mtimeMs).toEqual(expect.any(Number));
    expect(result.ctimeMs).toEqual(expect.any(Number));
    expect(result.mode).toEqual(expect.any(Number));
  });
});
