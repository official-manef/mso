#!/usr/bin/env node
// MSO <-> Orca bridge over MCP stdio.
//
// WHY stdio and not an MSO HTTP tool: the MSO MCP server runs on the VPS, the
// Orca runtime is a Windows desktop app on the laptop. A VPS-side tool cannot
// reach it. This server is spawned locally by the MCP client (OpenCode/Hermes),
// so it inherits the laptop's WSL interop and the `orca` CLI shim.
//
// Every tool is a thin argv mapping onto `orca <cmd> --json`. No shell is
// involved (spawn with an argv array), so no quoting/injection surface.
//
// Override the CLI with ORCA_BIN. Default: `orca` on PATH, then the WSL launcher.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildArgv, needsEnvironmentId, TOOLS, toolDescriptors } from "./orca-mcp-tools.mjs";

const CANDIDATES = [process.env.ORCA_BIN, join(homedir(), ".local/bin/orca-ide"), "/opt/Orca/resources/bin/orca-ide"].filter(Boolean);
const DEFAULT_TIMEOUT_MS = 120_000;

const str = (a, k) => (typeof a?.[k] === "string" && a[k].trim() ? a[k] : undefined);
const num = (a, k) => (Number.isFinite(a?.[k]) ? Number(a[k]) : undefined);

/** Run the Orca CLI and return parsed JSON (or raw text when it is not JSON). */
export function orca(bin, argv, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, [...argv, "--json"], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({ ok: false, error: `cannot spawn ${bin}: ${error.message}` });
      return;
    }
    let out = "", err = "", done = false;
    const finish = (result) => { if (!done) { done = true; clearTimeout(timer); resolve(result); } };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, error: `orca ${argv.join(" ")} timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (c) => { out += c; });
    child.stderr.setEncoding("utf8").on("data", (c) => { err += c; });
    child.on("error", (error) => finish({ ok: false, error: `orca failed to start: ${error.message}` }));
    child.on("close", (code) => {
      const text = out.trim();
      if (code !== 0) {
        finish({ ok: false, error: (err || text || `orca exited with code ${code}`).trim().slice(0, 4000) });
        return;
      }
      if (!text) { finish({ ok: true, value: null }); return; }
      try { finish({ ok: true, value: JSON.parse(text) }); }
      catch { finish({ ok: true, value: text.slice(0, 20_000) }); }
    });
  });
}
export { toolDescriptors, TOOLS };

function text(value) { return [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }]; }

async function callTool(bin, name, args) {
  if (!TOOLS[name]) return { content: text(`unknown tool: ${name}`), isError: true };
  const argv = buildArgv(name, args ?? {});
  if (!argv) return { content: text(`${name}: missing required argument`), isError: true };
  // worktree create only targets a remote board via --host runtime:<environment-id>,
  // so a friendly environment name has to be resolved to its id first.
  if (needsEnvironmentId(name, args ?? {})) {
    const listed = await orca(bin, ["environment", "list"]);
    const envs = listed.ok ? (listed.value?.result?.environments ?? []) : [];
    const wanted = String(args.host).trim();
    const match = envs.find((e) => e.name === wanted) ?? envs.find((e) => e.id === wanted);
    if (!match) return { content: text(`unknown Orca environment: ${wanted}. Run orca_host_list to see paired runtimes.`), isError: true };
    const index = argv.findIndex((v) => v === "--environment");
    if (index >= 0) argv.splice(index, 2);
    argv.push("--host", `runtime:${match.id}`);
  }
  const result = await orca(bin, argv, { timeoutMs: num(args, "timeout_ms") ?? DEFAULT_TIMEOUT_MS });
  if (!result.ok) return { content: text(`orca ${argv.join(" ")}\n${result.error}`), isError: true };
  return { content: text(labelHost(result.value ?? { ok: true }, args)) };
}

// Every board row must say which machine it lives on. Orca's own rows carry
// hostId only for git worktrees and omit it for folder workspaces, so stamp the
// host this call was routed to. Handles from another host are unusable here.
function labelHost(value, args) {
  const host = typeof args?.host === "string" && args.host.trim() ? args.host.trim() : "local";
  const worktrees = value?.result?.worktrees;
  if (!Array.isArray(worktrees)) return value;
  return { ...value, result: { ...value.result, worktrees: worktrees.map((row) => ({ host, ...row })) } };
}

export function createServer(bin) {
  /** @param {any} msg @returns {Promise<any>} */
  const handle = async (msg) => {
    const id = msg.id;
    const reply = (result) => ({ jsonrpc: "2.0", id, result });
    const fail = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
    switch (msg.method) {
      case "initialize":
        return reply({
          protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "mso-orca", version: "0.1.0" },
        });
      case "tools/list":
        return reply({ tools: toolDescriptors() });
      case "tools/call":
        try {
          return reply(await callTool(bin, msg.params?.name, msg.params?.arguments));
        } catch (error) {
          return reply({ content: text(String(error?.message ?? error)), isError: true });
        }
      case "ping":
        return reply({});
      default:
        if (msg.id === undefined) return null; // notification (initialized, cancelled)
        return fail(-32601, `method not found: ${msg.method}`);
    }
  };
  return { handle };
}

function main() {
  const bin = CANDIDATES.find((candidate) => existsSync(candidate)) ?? CANDIDATES[0];
  const { handle } = createServer(bin);
  const write = (msg) => { if (msg) process.stdout.write(`${JSON.stringify(msg)}\n`); };
  const rl = createInterface({ input: process.stdin, terminal: false });
  let queue = Promise.resolve();
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try { msg = JSON.parse(trimmed); } catch { write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); return; }
    // Serialize tool calls: Orca CLI invocations are cheap but not concurrent-safe on one worktree.
    queue = queue.then(() => handle(msg)).then(write, (error) => write({ jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32603, message: String(error?.message ?? error) } }));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) main();
