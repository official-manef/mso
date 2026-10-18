import { constants, promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { constantTimeEq } from "./session";
import { extractLoginPassword, LoginPasswordError, passwordPolicyError, readLoginPasswordEnvironment, rotateLoginPassword } from "./login-password";

async function safeParent(file: string): Promise<void> {
  const parent = path.dirname(file);
  const stat = await fs.lstat(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o022)) {
    throw new LoginPasswordError("password_file_unsafe");
  }
}

export async function localPasswordStatus(file: string) {
  await safeParent(file);
  try { await fs.lstat(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { configured: false, sessionConfigured: false };
    throw new LoginPasswordError("password_file_unsafe");
  }
  const text = await readLoginPasswordEnvironment(file);
  extractLoginPassword(text);
  return { configured: true, sessionConfigured: /^OS_SESSION_SECRET=.+$/m.test(text) };
}

export async function setLocalPassword(file: string, input: { current: string; next: string; confirm: string }) {
  const status = await localPasswordStatus(file);
  if (passwordPolicyError(input.next)) throw new LoginPasswordError("weak_password");
  if (!constantTimeEq(input.next, input.confirm)) throw new LoginPasswordError("mismatch");
  if (status.configured) {
    const text = await readLoginPasswordEnvironment(file);
    process.env.OS_LOGIN_PASSWORD = extractLoginPassword(text);
    await rotateLoginPassword({ ...input, actor: "local-cli", file });
    return;
  }
  if (input.current) throw new LoginPasswordError("password_source_mismatch");
  const tmp = path.join(path.dirname(file), `.mso-password-${randomBytes(16).toString("hex")}.tmp`);
  let created = false;
  try {
    const handle = await fs.open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    created = true;
    try {
      await handle.writeFile(`OS_LOGIN_PASSWORD=${input.next}\nOS_SESSION_SECRET=${randomBytes(32).toString("hex")}\nOS_MCP_ENABLED=0\nOS_MCP_MAX_SCOPE=read\n`);
      await handle.sync();
    } finally { await handle.close(); }
    await fs.link(tmp, file);
  } catch {
    throw new LoginPasswordError("password_file_unsafe");
  } finally {
    if (created) await fs.unlink(tmp).catch(() => undefined);
  }
}
