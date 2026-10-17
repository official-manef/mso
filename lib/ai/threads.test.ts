import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

// Point the store at a temp dir BEFORE importing (the dir is read at module load).
process.env.OS_THREADS_DIR = path.join(os.tmpdir(), `mso-threads-test-${process.pid}`);
const { saveThread, getThread, listThreads, deleteThread, renameThread } = await import("./threads");

describe("thread YAML store", () => {
  it("round-trips a thread through YAML (save → get → list → delete)", async () => {
    await saveThread({
      id: "thread_abc",
      title: "Hello",
      createdAt: 1,
      updatedAt: 1,
      messages: [{ role: "user", text: "hi: there\nline2" }],
      history: [{ role: "user", text: "hi" }],
    });
    const got = await getThread("thread_abc");
    expect(got?.title).toBe("Hello");
    // YAML must preserve colons + newlines inside message text.
    expect((got?.messages[0] as { text: string }).text).toBe("hi: there\nline2");

    expect((await listThreads()).map((s) => s.id)).toContain("thread_abc");
    await deleteThread("thread_abc");
    expect(await getThread("thread_abc")).toBeNull();
  });

  it("rejects traversal instead of rewriting it into a colliding filename", async () => {
    await expect(saveThread({ id: "a/../b", title: "x", createdAt: 1, updatedAt: 1, messages: [], history: [] }))
      .rejects.toThrow("invalid thread id");
    await expect(getThread("../outside")).rejects.toThrow("invalid thread id");
    await expect(deleteThread("../outside")).rejects.toThrow("invalid thread id");
    const names = await fs.readdir(process.env.OS_THREADS_DIR!);
    expect(names.every((n) => !n.includes("/") && !n.includes(".."))).toBe(true);
  });

  it("renames a thread without touching messages, history, or creation time", async () => {
    const originalMessages = [{ role: "user", text: "keep me" }];
    const originalHistory = [{ role: "user", text: "wire turn" }];
    await saveThread({
      id: "thread_rename_test",
      title: "Before Rename",
      createdAt: 12345,
      updatedAt: 12345,
      messages: originalMessages,
      history: originalHistory,
    });

    const summary = await renameThread("thread_rename_test", "After Rename");
    expect(summary).not.toBeNull();
    expect(summary?.id).toBe("thread_rename_test");
    expect(summary?.title).toBe("After Rename");
    expect(summary?.createdAt).toBe(12345);
    expect(summary?.updatedAt).toBeGreaterThanOrEqual(12345);

    const reloaded = await getThread("thread_rename_test");
    expect(reloaded?.title).toBe("After Rename");
    expect(reloaded?.createdAt).toBe(12345);
    expect(reloaded?.messages).toEqual(originalMessages);
    expect(reloaded?.history).toEqual(originalHistory);

    // Non-existent thread returns null
    const missing = await renameThread("thread_not_found", "New Title");
    expect(missing).toBeNull();

    // Invalid id throws
    await expect(renameThread("../escape", "Title")).rejects.toThrow("invalid thread id");
  });
});
