import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, it } from "vitest";

it("checks local password storage and real hidden terminal prompts in isolated fixtures", () => {
  const output = execFileSync(process.execPath, ["--test", path.join(process.cwd(), "scripts/mso-passwd.node.mjs")], {
    encoding: "utf8",
    timeout: 30_000,
  });
  expect(output).toMatch(/(?:pass 7|tests 7)/);
}, 35_000);
