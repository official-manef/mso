import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agentGroupApp } from "./index";

describe("Agent groups shell feature", () => {
  it("is a first-class app registered in the shell and App Store", () => {
    expect(agentGroupApp.id).toBe("agent-group");
    expect(agentGroupApp.noDock).not.toBe(true);
    expect(readFileSync("frontend/slices/os-shell/shell.manifest.ts", "utf8")).toContain('withSlug(withArtwork(agentGroupApp), "agent-groups")');
    expect(readFileSync("frontend/slices/app-store/lib/system-catalog.ts", "utf8")).toContain('id: "agent-group", title: "Agent groups", kind: "app"');
  });

  it("keeps bot secrets in Integrations and drives run/stop/turn rendering", () => {
    const app = readFileSync("frontend/slices/agent-group/app.tsx", "utf8");
    const editor = readFileSync("frontend/slices/agent-group/components/agent-group-editor.tsx", "utf8");
    const card = readFileSync("frontend/slices/agent-group/components/agent-group-card.tsx", "utf8");
    const api = readFileSync("frontend/slices/agent-group/lib/api.ts", "utf8");
    expect(app).toContain('data-slot="agent-group-feature"');
    expect(api).toContain("/api/v1/channels");
    expect(editor).not.toContain("botToken");
    expect(card).toContain('data-slot="agent-group-turn"');
    expect(card).toContain("stopAgentGroup");
  });
});
