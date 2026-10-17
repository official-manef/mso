import path from "node:path";
import { LoginPasswordError } from "../lib/auth/login-password";
import { localPasswordStatus, setLocalPassword } from "../lib/auth/local-password";

const [root, action, ...extra] = process.argv.slice(2);
try {
  if (!root || !path.isAbsolute(root) || extra.length || !["status", "set"].includes(action)) throw new Error("usage");
  const file = path.join(root, ".env.local");
  if (action === "status") {
    console.log(JSON.stringify(await localPasswordStatus(file)));
  } else {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of process.stdin) {
      length += chunk.length;
      if (length > 4096) throw new Error("input");
      chunks.push(Buffer.from(chunk));
    }
    const values = Buffer.concat(chunks).toString("utf8").split("\0");
    if (values.length !== 4 || values.pop() !== "") throw new Error("input");
    const [current, next, confirm] = values;
    await setLocalPassword(file, { current, next, confirm });
    console.log("Password saved locally. Start/restart MSO manually to apply; existing sessions are unchanged.");
  }
} catch (error) {
  const code = error instanceof LoginPasswordError ? error.code : "password_command_failed";
  console.error(`mso passwd: ${code}`);
  process.exitCode = 1;
}
