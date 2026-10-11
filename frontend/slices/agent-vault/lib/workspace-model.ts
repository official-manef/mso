import type { AgentVaultNote, AgentVaultSnapshot, AgentVaultState } from "@/lib/contracts/agent-vault";
import type { MemoryGraphDocument, MemoryGraphNode } from "@/lib/memory-graph/types";

export type WorkspaceView = "vault" | "memory" | "organization";
export interface WorkspaceNode extends MemoryGraphNode { note?: AgentVaultNote }
export interface WorkspaceDocument extends MemoryGraphDocument { nodes: WorkspaceNode[] }

/** One node/edge model; snapshot metadata is usable before optional links arrive. */
export function workspaceDocument(state: AgentVaultState | null, snapshot: AgentVaultSnapshot | undefined, graph: MemoryGraphDocument | null): WorkspaceDocument {
  const root = state && snapshot ? `${state.root}/Snapshots/${snapshot.id}` : null;
  const notes: WorkspaceNode[] = (snapshot?.notes ?? []).map(note => {
    const relative = note.path.slice(`Snapshots/${snapshot!.id}/`.length);
    return { id: `note:${relative.replace(/\.md$/i, "")}`, title: note.title, kind: "note", group: relative.includes("/") ? relative.split("/")[0] : "Notes", degree: 0, path: `${state!.root}/${note.path}`, note };
  });
  const nodes = new Map(notes.map(node => [node.id, node]));
  for (const node of graph?.nodes ?? []) { const note = nodes.get(node.id)?.note; nodes.set(node.id, { ...node, ...(note ? {title:note.title, note} : {}) }); }
  const edges = [...(graph?.edges ?? [])];
  for (const group of new Set(notes.map(node => node.group))) {
    const id = `folder:${group}`;
    if (!nodes.has(id)) nodes.set(id, { id, title: group, kind: "folder", group, degree: 0 });
    for (const note of notes.filter(node => node.group === group)) if (!edges.some(edge => edge.source === id && edge.target === note.id && edge.kind === "contains")) edges.push({ source: id, target: note.id, kind: "contains", resolved: true });
  }
  return { nodes: [...nodes.values()], edges, root: graph?.root ?? root, counts: { notes: Math.max(notes.length, graph?.counts.notes ?? 0), memories: graph?.counts.memories ?? 0, ghosts: graph?.counts.ghosts ?? 0 }, truncated: Boolean(snapshot?.truncated || graph?.truncated), warnings: [...new Set([...(snapshot?.warnings ?? []), ...(graph?.warnings ?? [])])] };
}
