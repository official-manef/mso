import { describe, expect, it } from "vitest";
import { MessageBubble } from "./message-bubble";
import { ApprovalCard } from "./approval-card";

// Streaming appends a message per token, re-rendering the whole transcript. These
// two leaf rows must be memoised or every prior row re-parses its markdown and its
// timestamp on every token. memo() wraps the component in an object with `$$typeof`
// React.memo marker; a plain function export would have neither.
const MEMO = Symbol.for("react.memo");

describe("chat transcript rows are memoised", () => {
  it("MessageBubble is a React.memo component", () => {
    expect((MessageBubble as unknown as { $$typeof?: symbol }).$$typeof).toBe(MEMO);
  });

  it("ApprovalCard is a React.memo component", () => {
    expect((ApprovalCard as unknown as { $$typeof?: symbol }).$$typeof).toBe(MEMO);
  });
});
