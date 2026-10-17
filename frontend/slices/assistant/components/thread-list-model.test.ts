import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { filterThreads, formatRelativeTime, sortThreads } from "./thread-list-model";

const source = fs.readFileSync(path.join(__dirname, "thread-list.tsx"), "utf8");

describe("filterThreads", () => {
  const items = [
    { id: "1", title: "Project Alpha discussion", updatedAt: 100 },
    { id: "2", title: "Beta release checklist", updatedAt: 200 },
    { id: "3", title: "ALPHABET test", updatedAt: 300 },
  ];

  it("returns all threads when query is empty or only whitespace", () => {
    expect(filterThreads(items, "")).toEqual(items);
    expect(filterThreads(items, "   ")).toEqual(items);
  });

  it("filters threads case-insensitively by title substring", () => {
    const alphaMatches = filterThreads(items, "alpha");
    expect(alphaMatches.map((t) => t.id)).toEqual(["1", "3"]);

    const betaMatches = filterThreads(items, "BETA");
    expect(betaMatches.map((t) => t.id)).toEqual(["2"]);
  });

  it("returns an empty array when no titles match", () => {
    expect(filterThreads(items, "gamma")).toEqual([]);
  });
});

describe("sortThreads", () => {
  it("sorts threads descending by updatedAt without mutating input", () => {
    const original = [
      { id: "old", title: "Old", updatedAt: 100 },
      { id: "new", title: "New", updatedAt: 500 },
      { id: "mid", title: "Mid", updatedAt: 300 },
    ];
    const clone = [...original];

    const sorted = sortThreads(original);
    expect(sorted.map((t) => t.id)).toEqual(["new", "mid", "old"]);
    expect(original).toEqual(clone);
  });

  it("handles missing or zero timestamps gracefully", () => {
    const items = [
      { id: "zero", title: "Zero", updatedAt: 0 },
      { id: "has_time", title: "Has Time", updatedAt: 50 },
      { id: "no_time", title: "No Time" as unknown as number, updatedAt: undefined as unknown as number },
    ];
    const sorted = sortThreads(items);
    expect(sorted[0].id).toBe("has_time");
  });
});

describe("formatRelativeTime", () => {
  const now = 1_000_000_000;

  it("returns 'just now' for non-positive or future timestamps", () => {
    expect(formatRelativeTime(0, now)).toBe("just now");
    expect(formatRelativeTime(-500, now)).toBe("just now");
    expect(formatRelativeTime(now + 10_000, now)).toBe("just now");
  });

  it("returns 'just now' within the first minute (< 60s)", () => {
    expect(formatRelativeTime(now, now)).toBe("just now");
    expect(formatRelativeTime(now - 30_000, now)).toBe("just now");
    expect(formatRelativeTime(now - 59_999, now)).toBe("just now");
  });

  it("formats minute boundary correctly", () => {
    expect(formatRelativeTime(now - 60_000, now)).toBe("1m ago");
    expect(formatRelativeTime(now - 120_000, now)).toBe("2m ago");
    expect(formatRelativeTime(now - 3_599_999, now)).toBe("59m ago");
  });

  it("formats hour boundary correctly", () => {
    expect(formatRelativeTime(now - 3_600_000, now)).toBe("1h ago");
    expect(formatRelativeTime(now - 7_200_000, now)).toBe("2h ago");
    expect(formatRelativeTime(now - 86_399_999, now)).toBe("23h ago");
  });

  it("formats day boundary correctly", () => {
    expect(formatRelativeTime(now - 86_400_000, now)).toBe("1d ago");
    expect(formatRelativeTime(now - 172_800_000, now)).toBe("2d ago");
  });
});

describe("thread list deletion confirmation", () => {
  it("gates thread deletion behind a confirmation step rather than immediate delete", () => {
    expect(source).toContain("confirmDeleteId");
    expect(source).toContain("Confirm");
    expect(source).not.toContain("onClick={() => del(t.id)}");
  });
});
