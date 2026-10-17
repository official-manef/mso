import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import os from "node:os";
import path from "node:path";

let mockSessionAuthorized = true;

const stableContext = {
  session: { device_id: "test-device", issued_at: 1, expires_at: 2, cookie_scope: "host", cookie_epoch: "epoch-0000000000000000" },
  device: { label: "test owner", approvedAt: 1, role: "owner" as const },
  role: "owner" as const,
};

vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: vi.fn(async () => (mockSessionAuthorized ? stableContext : null)),
  requireSession: vi.fn(async () => mockSessionAuthorized),
}));

process.env.OS_THREADS_DIR = path.join(os.tmpdir(), `mso-threads-route-test-${process.pid}`);

const { GET, POST, PATCH } = await import("./route");
const { getThread, saveThread } = await import("@/lib/ai/threads");

function patchRequest(body: unknown) {
  return new NextRequest("http://localhost/api/threads", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/threads route", () => {
  beforeEach(() => {
    mockSessionAuthorized = true;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("enforces owner session on PATCH", async () => {
    mockSessionAuthorized = false;
    const res = await PATCH(patchRequest({ id: "any", title: "any" }));
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("creates and retrieves threads via POST and GET", async () => {
    const postReq = new NextRequest("http://localhost/api/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "thread_post_get",
        title: "Test Thread",
        messages: [{ role: "user", text: "hi" }],
      }),
    });
    const postRes = await POST(postReq);
    expect(postRes.status).toBe(200);

    const getReq = new NextRequest("http://localhost/api/threads?id=thread_post_get");
    const getRes = await GET(getReq);
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.title).toBe("Test Thread");
  });

  it("renames only the title and preserves messages and history", async () => {
    const threadId = "thread_patch_ok";
    await saveThread({
      id: threadId,
      title: "Original Title",
      createdAt: 5000,
      updatedAt: 5000,
      messages: [{ role: "user", text: "hello world" }],
      history: [{ role: "user", text: "hello" }],
    });

    const res = await PATCH(patchRequest({ id: threadId, title: "Updated Title" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.thread.title).toBe("Updated Title");
    expect(body.thread.id).toBe(threadId);

    const reloaded = await getThread(threadId);
    expect(reloaded?.title).toBe("Updated Title");
    expect(reloaded?.messages).toEqual([{ role: "user", text: "hello world" }]);
    expect(reloaded?.history).toEqual([{ role: "user", text: "hello" }]);
    expect(reloaded?.createdAt).toBe(5000);
  });

  it("rejects invalid id including path traversal and symbols", async () => {
    const invalidIds = ["../escaped", "has space", "bad@id", "", "id/slash"];
    for (const id of invalidIds) {
      const res = await PATCH(patchRequest({ id, title: "Valid Title" }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("invalid id");
    }
  });

  it("rejects over-long id exceeding 64 characters", async () => {
    const longId = "a".repeat(65);
    const res = await PATCH(patchRequest({ id: longId, title: "Valid Title" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("invalid id");
  });

  it("rejects invalid or empty title", async () => {
    const invalidTitles = ["", "   ", null, 123, undefined];
    for (const title of invalidTitles) {
      const res = await PATCH(patchRequest({ id: "valid_id", title }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("invalid title");
    }
  });

  it("clamps over-long title to 120 characters", async () => {
    const threadId = "thread_clamp_title";
    await saveThread({
      id: threadId,
      title: "Before Clamp",
      createdAt: 1000,
      updatedAt: 1000,
      messages: [{ role: "user", text: "clamp test" }],
      history: [],
    });

    const overLongTitle = "T".repeat(200);
    const res = await PATCH(patchRequest({ id: threadId, title: overLongTitle }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.thread.title).toBe("T".repeat(120));
    expect(body.thread.title.length).toBe(120);

    const reloaded = await getThread(threadId);
    expect(reloaded?.title).toBe("T".repeat(120));
  });

  it("returns 404 when renaming non-existent thread", async () => {
    const res = await PATCH(patchRequest({ id: "thread_missing", title: "New Name" }));
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("not_found");
  });
});
