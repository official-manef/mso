import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActiveShellProvider, type ShellId } from "@/features/appshell";
import { APP_MARKS } from "./brand-marks";

function markup(id: string, shell: ShellId = "macos") {
  const Icon = APP_MARKS[id];
  if (!Icon) throw new Error(`missing app mark ${id}`);
  return renderToStaticMarkup(<ActiveShellProvider id={shell} surface={shell === "ios" || shell === "android" ? "mobile" : "desktop"}><Icon className="size-full" /></ActiveShellProvider>);
}

describe("third-party official app marks", () => {
  it.each([
    ["camoufox-browser", "/brand/official/camoufox.webp"],
    ["hermes", "/brand/official/hermes.webp"],
    ["openclaw", "/brand/official/openclaw.webp"],
    ["9router", "/brand/official/9router.webp"],
  ])("keeps %s shell-invariant and official", (id, src) => {
    const html = markup(id);
    expect(html).toContain(`src="${src}"`);
    expect(html).not.toContain("shell-artwork-macos");
    expect(html).not.toContain("shell-artwork-windows");
  });

  it.each([
    ["macos", "/app-icons/macos/files.webp"],
    ["ios", "/app-icons/macos/files.webp"],
    ["windows", "/app-icons/windows/files.webp"],
    ["android", "/app-icons/windows/files.webp"],
    ["dashboard", "/app-icons/files.webp"],
  ] as const)("renders only the active %s artwork", (shell, src) => {
    const html = markup("files-manager", shell);
    expect(html.match(/<img\b/g)).toHaveLength(1);
    expect(html).toContain(`src="${src}"`);
    for (const other of ["/app-icons/macos/files.webp", "/app-icons/windows/files.webp", "/app-icons/files.webp"].filter(path => path !== src)) expect(html).not.toContain(other);
  });
});
