import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { TOOLS } = await import("./tools");
const { toolDescriptor } = await import("./tool-contract");

describe("MCP advertised tool contract", () => {
  it("gives every global MSO tool a title, required safety hints, and matching OAuth security metadata", () => {
    expect(new Set(TOOLS.map((tool) => tool.name)).size).toBe(TOOLS.length);
    for (const tool of TOOLS) {
      const descriptor = toolDescriptor(tool);
      expect(descriptor.title.trim().length, tool.name).toBeGreaterThan(0);
      expect(descriptor.title.length, tool.name).toBeLessThanOrEqual(80);
      expect(descriptor.annotations).toEqual(expect.objectContaining({ readOnlyHint: expect.any(Boolean), destructiveHint: expect.any(Boolean), openWorldHint: expect.any(Boolean) }));
      expect(descriptor.securitySchemes).toEqual([{ type: "oauth2", scopes: [tool.scope] }]);
      expect(descriptor._meta.securitySchemes).toEqual(descriptor.securitySchemes);
    }
  });

  it("keeps private project MCP tool names out of the global catalog", () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(names).toContain("project_mcp_tools");
    expect(names).toContain("project_mcp_call");
    expect(names.some((name) => name === "private_echo" || name.startsWith("project_fixture_"))).toBe(false);
  });

  it("adds the generic output envelope only to the compact ChatGPT profile", () => {
    const fileList = TOOLS.find((tool) => tool.name === "fs_list");
    expect(fileList).toBeDefined();
    expect(toolDescriptor(fileList!, "full")).not.toHaveProperty("outputSchema");
    expect(toolDescriptor(fileList!, "chatgpt").outputSchema).toEqual({ type: "object", properties: { result: {} }, required: ["result"], additionalProperties: false });
  });

  it("publishes additive action contracts on full MCP descriptors without bloating the compact ChatGPT scanner", () => {
    const write = TOOLS.find((tool) => tool.name === "fs_write");
    expect(write).toBeDefined();
    const full = toolDescriptor(write!, "full");
    expect(full._meta["mso/actionContract"]).toMatchObject({
      version: 1, phase: "mutate", target: "filesystem-text", concurrency: "hash",
    });
    expect(toolDescriptor(write!, "chatgpt")._meta).not.toHaveProperty("mso/actionContract");
  });

  it.each([
    ["Read bounded workflow details before editing.", "Read bounded workflow…"],
    ["Read bounded workflow snapshots from disk.", "Read bounded workflow…"],
    ["x".repeat(50), `${"x".repeat(23)}…`],
    ["Read workflow safely. Continue when ready.", "Read workflow safely.…"],
    ["Read workflow safely; continue when ready.", "Read workflow safely;…"],
    ["Inspect source safely", "Inspect source safely"],
  ])("compacts %j within the existing bound without unnecessary word fragments", (description, expected) => {
    const original = TOOLS.find((tool) => tool.name === "fs_list")!;
    const tool = { ...original, description, chatgptDescription: description };
    const compact = toolDescriptor(tool, "chatgpt");
    expect(compact.description).toBe(expected);
    expect(compact.description.length).toBeLessThanOrEqual(24);
    expect(toolDescriptor(tool, "full").description).toBe(description);
  });

  it("keeps the full description when a compact client description is supplied", () => {
    const original = TOOLS.find((tool) => tool.name === "fs_list")!;
    const description = "Read bounded workflow details before editing. Preserve this complete instruction.";
    const tool = { ...original, description, chatgptDescription: "Read bounded workflow snapshots from disk." };
    expect(toolDescriptor(tool, "chatgpt").description).toBe("Read bounded workflow…");
    const full = toolDescriptor(tool, "full");
    expect(full.description).toBe(description);
    expect(full.inputSchema).toEqual(tool.inputSchema);
    expect(full.outputSchema).toEqual(tool.outputSchema);
  });

  it("preserves the first-call instruction override for workflow_start", () => {
    const original = TOOLS.find((tool) => tool.name === "workflow_start")!;
    expect(toolDescriptor({ ...original, chatgptDescription: "Inspect source safely" }, "chatgpt").description).toBe("First call: multi-step");
  });

});
