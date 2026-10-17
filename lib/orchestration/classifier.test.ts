import { describe, expect, it } from "vitest";
import { classifyTask, gitChangedPaths, sharedResourceWarnings, sourceChangeLikely } from "./classifier";

describe("RASMIC risk and contention classifier", () => {
  it("keeps trivial docs work low-risk but isolates the source mutation", () => {
    const result = classifyTask({ intent: "fix a typo in docs only", scope: "write" });
    expect(result).toMatchObject({
      risk: "low",
      complexity: "light",
      isolation: "isolated-worktree",
      verification: "targeted",
    });
  });

  it("isolates contained feature work even when its risk remains medium", () => {
    const result = classifyTask({ intent: "implement one contained feature across a few files", scope: "write" });
    expect(result).toMatchObject({ risk: "medium", isolation: "isolated-worktree", verification: "affected" });
  });

  it("does not create source-change pressure for a read-only project audit", () => {
    expect(sourceChangeLikely("audit the repository and explain the current state")).toBe(false);
    const result = classifyTask({ intent: "audit the repository and explain the current state", scope: "write" });
    expect(result.isolation).toBe("direct");
  });

  it.each([
    ["Check hostname.", "Read only; do not modify files."],
    ["Periksa hostname.", "Hanya observasi; jangan edit file."],
    ["Periksa hostname.", "Hanya observasi; jangan ubah file."],
    ["Check hostname; do not change files.", ""],
    ["Check hostname.", "Do not write, edit, or modify files."],
    ["Check hostname.", "Do not edit, modify, or update files."],
    ["Check hostname.", "Don’t change files."],
    ["Check hostname.", "Never edit or modify files."],
    ["Periksa hostname.", "Jangan pernah edit atau modify file."],
  ])("keeps a directly negated mutation observational: %s %s", (intent, constraints) => {
    expect(sourceChangeLikely(intent, constraints)).toBe(false);
    expect(classifyTask({ intent, constraints, scope: "exec" }).isolation).toBe("optional-worktree");
  });

  it.each([
    ["Fix the source bug.", "Do not modify unrelated files."],
    ["Do not edit docs; update the source file.", ""],
    ["Do not edit docs but modify code.", ""],
    ["Do not edit docs, then write tests.", ""],
    ["Do not edit docs and update code.", ""],
    ["Not only edit docs but fix code.", ""],
    ["Do not forget to fix code.", ""],
    ["Read only; implement a feature.", ""],
    ["No source changes; write docs.", ""],
    ["Do not edit, implement the feature from scratch.", ""],
    ["Do not edit, and implement the feature from scratch.", ""],
    ["Do not edit, or implement the feature instead.", ""],
    ["Do not edit, modify, write files.", ""],
  ])("preserves positive mutation evidence: %s %s", (intent, constraints) => {
    expect(sourceChangeLikely(intent, constraints)).toBe(true);
    expect(classifyTask({ intent, constraints, scope: "exec" }).isolation).toBe("isolated-worktree");
  });

  it("isolates explicitly declared paths without requiring a recognized mutation verb or collision", () => {
    const input = { intent: "Sesuaikan nilai sumber.", constraints: "Do not edit unrelated files.", scope: "exec" as const };
    expect(sourceChangeLikely(input.intent, input.constraints, ["src/value.ts"])).toBe(true);
    expect(classifyTask({ ...input, affectedPaths: ["src/value.ts"] }).isolation).toBe("isolated-worktree");
    expect(classifyTask({ ...input, collisionPaths: ["src/value.ts"] }).isolation).toBe("isolated-worktree");
  });

  it("retains the separate high-risk policy even for a negated operation", () => {
    expect(classifyTask({ intent: "Check hostname.", constraints: "Do not deploy.", scope: "exec" }))
      .toMatchObject({ risk: "high", isolation: "isolated-worktree" });
  });

  it("requires isolated work for high-risk auth/schema/infra work", () => {
    const result = classifyTask({
      intent: "refactor authentication and database schema before production deployment",
      scope: "exec",
    });
    expect(result).toMatchObject({ risk: "high", complexity: "heavy", isolation: "isolated-worktree", verification: "full" });
  });

  it("raises contention before a merge conflict when another workflow and shared files exist", () => {
    const result = classifyTask({
      intent: "upgrade dependencies for the release",
      scope: "exec",
      changedPaths: ["package.json", "src/auth/index.ts"],
      activeProjectWorkflows: 1,
    });
    expect(result.contention).toBe("high");
    expect(result.sharedResourceWarnings.join(" ")).toMatch(/package|deployment/);
  });

  it("extracts changed paths and shared resources from git status lines", () => {
    expect(gitChangedPaths([" M package.json", "R  src/a.ts -> src/b.ts", "?? docs/new.md"])).toEqual([
      "package.json",
      "src/b.ts",
      "docs/new.md",
    ]);
    expect(sharedResourceWarnings("run docker service on port 4173", [])).toEqual(expect.arrayContaining([
      expect.stringContaining("port"),
      expect.stringContaining("container"),
    ]));
  });
});
