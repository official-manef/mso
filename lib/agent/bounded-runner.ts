import { streamPreparedSelectedModel, type PreparedSelectedModel } from "@/lib/ai/selected-model-stream";
import type { OaMsg, OaToolUse } from "@/lib/ai/openai-stream";
import { allows } from "@/lib/capabilities/scope";
import { liveCapabilityContext } from "@/lib/capabilities/live-authority";
import type { CapabilityDescriptor, CapabilityRuntime } from "@/lib/capabilities/runtime";
import type { CapabilityRunContext } from "@/lib/capabilities/tool";

export interface BoundedAgentProgress { text: string; toolCalls: Array<{ name: string; ok: boolean }>; }
function bounded(value: string, max = 64 * 1024): string {
  if (Buffer.byteLength(value, "utf8") <= max) return value;
  let out = value;
  while (Buffer.byteLength(out, "utf8") > max - 80) out = out.slice(0, Math.floor(out.length * 0.9));
  return `${out}\n…[truncated by MSO agent result budget]`;
}

export async function runBoundedAgent(input: {
  prepared: PreparedSelectedModel;
  objective: string;
  system: string;
  capabilities: CapabilityRuntime;
  authority: CapabilityRunContext;
  actor: string;
  tools: (context: CapabilityRunContext) => CapabilityDescriptor[];
  maxTurns: number;
  maxToolCalls?: number;
  signal: AbortSignal;
  progress?: BoundedAgentProgress;
}) {
  const progress = input.progress ?? { text: "", toolCalls: [] };
  const messages: OaMsg[] = [{ role: "user", text: input.objective }];
  const authority = { ...input.authority, capabilities: input.capabilities, signal: input.signal };
  const live = async (name?: string, args?: Record<string, unknown>) => {
    input.signal.throwIfAborted();
    await authority.liveAuthorization?.();
    const context = await liveCapabilityContext(authority, name, args);
    input.signal.throwIfAborted();
    return context;
  };
  const finish = (status: "completed" | "partial", rounds: number, fallback = "") => ({
    status, rounds, text: progress.text.trim() || fallback, toolCalls: progress.toolCalls, messages,
  });
  for (let round = 1; round <= input.maxTurns; round += 1) {
    const current = await live();
    const tools = input.tools(current).map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema }));
    let text = "";
    const uses: OaToolUse[] = [];
    await streamPreparedSelectedModel({ prepared: input.prepared, messages, tools, system: input.system, signal: input.signal,
      emit(event, data) {
        if (event === "delta") text += String(data ?? "");
        else if (event === "tool_use") uses.push(data as OaToolUse);
      },
    });
    await live();
    if (text) progress.text = bounded(text);
    messages.push({ role: "assistant", text, toolUses: uses });
    if (!uses.length) return finish("completed", round);
    const results: { id: string; content: string; isError?: boolean }[] = [];
    for (const [index, call] of uses.entries()) {
      if (input.maxToolCalls !== undefined && progress.toolCalls.length >= input.maxToolCalls) {
        // Keep completed outcomes and close every proposed tool-use id before persisting this partial turn.
        for (const pending of uses.slice(index)) results.push({ id: pending.id, content: "error: not executed; agent tool-call limit reached", isError: true });
        messages.push({ role: "tool", results });
        await live();
        return finish("partial", round, "Agent reached its tool-call limit before a final answer.");
      }
      const context = await live(call.name, call.input ?? {});
      const tool = input.tools(context).find(entry => entry.name === call.name);
      if (!tool || !allows(context.scope, tool.scope) || context.allowedTools && !context.allowedTools.includes(call.name)) {
        results.push({ id: call.id, content: "error: tool unavailable to this agent", isError: true });
        progress.toolCalls.push({ name: call.name, ok: false });
        continue;
      }
      const result = await input.capabilities.invoke({ ...context, name: call.name, args: call.input ?? {}, actor: input.actor });
      await live();
      const content = result.content.filter(row => row.type === "text").map(row => row.text).join("\n") || JSON.stringify(result.content);
      results.push({ id: call.id, content: bounded(content), ...(result.isError ? { isError: true } : {}) });
      progress.toolCalls.push({ name: call.name, ok: !result.isError });
    }
    messages.push({ role: "tool", results });
  }
  await live();
  return finish("partial", input.maxTurns, "Agent reached its turn limit before a final answer.");
}
