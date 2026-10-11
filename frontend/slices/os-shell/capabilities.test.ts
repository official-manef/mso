import { beforeEach, afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ stats: vi.fn(), usage: vi.fn(), unsubscribe: undefined as undefined | (() => void) }));
vi.mock("react", () => ({ useCallback: (fn: unknown) => fn, useSyncExternalStore: (subscribe: (cb: () => void) => () => void, snap: () => unknown) => {
  state.unsubscribe?.(); state.unsubscribe = subscribe(() => {}); return snap();
} }));
vi.mock("@/features/appshell", () => ({ useOsApi: () => ({ sys: { stats: state.stats }, fs: { usage: state.usage } }), openWindow: vi.fn() }));
vi.mock("@/lib/appearance", () => ({ effectiveServerTarget: vi.fn(), selectServerTarget: vi.fn(), useAppearance: vi.fn() }));
vi.mock("@/lib/demo", () => ({ IS_DEMO: false }));
vi.mock("@/lib/quicklinks", () => ({ faviconUrl: vi.fn(), openQuicklink: vi.fn(), useQuicklinks: vi.fn() }));
let windowEvents: EventTarget;
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); state.stats.mockReset(); state.usage.mockReset();
  state.stats.mockResolvedValue({ cpu: { pct: 10, cores: 2 }, mem: { used: 1, total: 10 } }); state.usage.mockResolvedValue({ used: 1, total: 10 });
  windowEvents = new EventTarget(); vi.stubGlobal("window", windowEvents); vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false }));
});
afterEach(() => { state.unsubscribe?.(); state.unsubscribe = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });
it("does not start host telemetry when a queued subscription runs after pagehide", async () => {
  const { topsideCapabilities } = await import("./capabilities");
  windowEvents.dispatchEvent(new Event("pagehide")); topsideCapabilities.useCpuPercent!();
  await vi.advanceTimersByTimeAsync(6000); expect(state.stats).not.toHaveBeenCalled(); expect(state.usage).not.toHaveBeenCalled();
});
it("pauses on pagehide, resumes on pageshow and stops on unsubscribe", async () => {
  const { topsideCapabilities } = await import("./capabilities"); topsideCapabilities.useCpuPercent!();
  await vi.advanceTimersByTimeAsync(0); expect(state.stats).toHaveBeenCalledTimes(1);
  windowEvents.dispatchEvent(new Event("pagehide")); await vi.advanceTimersByTimeAsync(6000); expect(state.stats).toHaveBeenCalledTimes(1);
  windowEvents.dispatchEvent(new Event("pageshow")); await vi.advanceTimersByTimeAsync(3000); expect(state.stats).toHaveBeenCalledTimes(2);
  state.unsubscribe?.(); state.unsubscribe = undefined; await vi.advanceTimersByTimeAsync(6000); expect(state.stats).toHaveBeenCalledTimes(2);
});
