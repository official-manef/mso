import { execFileSync } from "node:child_process";
import { PATH_FIELDS } from "./inventory.mjs";
export function validateCandidateMappings(implementation, root, commit = "HEAD") {
  const entries = execFileSync("git", ["ls-tree", "-rz", "--full-tree", commit], { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const paths = new Map(entries.split("\0").filter(Boolean).map(entry => {
    const tab = entry.indexOf("\t"), [mode, type] = entry.slice(0, tab).split(" ");
    return [entry.slice(tab + 1), { mode, type }];
  }));
  for (const row of implementation.requirements) for (const field of PATH_FIELDS) for (const name of row[field]) {
    const entry = paths.get(name);
    if (!entry || entry.type !== "blob" || !["100644", "100755"].includes(entry.mode))
      throw new Error(`${row.id}: ${name} is not a tracked regular blob in the candidate`);
  }
}
export function candidateHead(root, requested) {
  const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const head = git(["rev-parse", "HEAD"]);
  if (requested && requested !== head) throw new Error("Requested commit is not HEAD");
  if (git(["ls-files", "-v", "-z"]).split("\0").some(entry => /^[a-zS] /.test(entry)))
    throw new Error("Candidate index hides tracked changes with assume-unchanged or skip-worktree flags");
  if (git(["status", "--porcelain", "--untracked-files=all"])) throw new Error("Candidate working tree is not clean");
  return head;
}
