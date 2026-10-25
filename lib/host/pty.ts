// SERVER-ONLY. Hosted-demo stub for the interactive PTY manager behind
// /api/v1/term/*. The demo variant has no host shell: every entry point fails
// with a curated HostError so routes render a clean "terminal unavailable"
// message instead of crashing. Same public surface as the full local build —
// no node-pty import, nothing to bundle or compile natively on Vercel.
import { HostError } from "./host-error";

const UNAVAILABLE = "terminal is unavailable in the hosted demo";

export type PtyListener = {
  /** `offset` = absolute stream position AFTER the chunk. Used as the SSE
   * event id so a Last-Event-ID reconnect resumes exactly where it left off. */
  onData: (chunk: string, offset: number) => void;
  onExit: (code: number) => void;
};

export async function openPty(opts: {
  cols: number;
  rows: number;
  cwd?: string;
  owner: string;
}): Promise<{ id: string; cwd: string }> {
  void opts;
  throw new HostError(UNAVAILABLE, 501);
}

/** Always false in the demo: no session can ever exist. */
export function hasPty(id: string, owner: string): boolean {
  void id;
  void owner;
  return false;
}

export function attachPty(
  id: string,
  owner: string,
  fromOffset: number,
  l: PtyListener,
): () => void {
  void id;
  void owner;
  void fromOffset;
  void l;
  throw new HostError(UNAVAILABLE, 501);
}

export function writePty(id: string, owner: string, data: string): void {
  void id;
  void owner;
  void data;
  throw new HostError(UNAVAILABLE, 501);
}

export function resizePty(id: string, owner: string, cols: number, rows: number): void {
  void id;
  void owner;
  void cols;
  void rows;
  throw new HostError(UNAVAILABLE, 501);
}

export function closePty(id: string, owner: string): boolean {
  void id;
  void owner;
  return false;
}
