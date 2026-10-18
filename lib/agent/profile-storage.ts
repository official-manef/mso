import { constants, promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { expandOwnerStorePath } from "@/lib/owner-store-path.js";
import { pinSecurityStorePath } from "@/lib/security-store-path";
import type { AgentProfileStore } from "@/lib/contracts/agent-profile";
import { AgentProfileError, emptyProfileStore, profilePrincipal, validateProfileStore } from "./profile-schema";

const MAX_BYTES = 4 * 1024 * 1024;
export function agentProfileFile(principal: string) {
  const root = path.resolve(expandOwnerStorePath(process.env.OS_AGENT_PROFILES_DIR ?? path.join(os.homedir(), ".mso", "agent-profiles")));
  const owner = createHash("sha256").update(profilePrincipal(principal)).digest("hex");
  return path.join(root, `${owner}.json`);
}
export async function readProfileStore(principal: string): Promise<AgentProfileStore> {
  const pinned = await pinSecurityStorePath(agentProfileFile(principal));
  let handle;
  try {
    handle = await fs.open(pinned.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_BYTES) throw new AgentProfileError("profile_store_invalid_shape", 500);
    if (stat.uid !== process.getuid?.() || (stat.mode & 0o077)) throw new AgentProfileError("profile_store_unsafe_permissions", 500);
    return validateProfileStore(JSON.parse(await handle.readFile("utf8")), principal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyProfileStore();
    throw error;
  } finally { await handle?.close().catch(() => undefined); await pinned.directory.close(); }
}
export async function writeProfileStore(principal: string, store: AgentProfileStore, authorize: () => Promise<void>) {
  validateProfileStore(store, principal);
  const body = JSON.stringify(store) + "\n";
  if (Buffer.byteLength(body) > MAX_BYTES) throw new AgentProfileError("profile_store_limit", 413);
  const pinned = await pinSecurityStorePath(agentProfileFile(principal));
  const temp = `${pinned.file}.${randomUUID()}.tmp`;
  let handle, renamed = false;
  try {
    await pinned.directory.chmod(0o700);
    handle = await fs.open(temp, "wx", 0o600);
    await handle.writeFile(body, "utf8");
    await handle.sync();
    await handle.close(); handle = undefined;
    await authorize();
    await fs.rename(temp, pinned.file); renamed = true;
    await pinned.directory.sync();
  } catch (error) {
    if (renamed) throw new AgentProfileError("profile_commit_uncertain_refresh_before_retry", 503);
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
    await fs.unlink(temp).catch(() => undefined);
    await pinned.directory.close().catch(() => undefined);
  }
}
