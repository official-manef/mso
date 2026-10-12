import { describe, expect, it } from "vitest";
import { ChannelError } from "./errors";
import { telegramGroupEvent } from "./service";
import { normalizeTelegramUpdate } from "./providers/telegram";
import type { ChannelInboundEvent } from "./types";

const update = (message: Record<string, unknown>, id = 1): ChannelInboundEvent =>
  normalizeTelegramUpdate({ update_id: id, message });

describe("telegram group discussion trigger", () => {
  it("accepts an owner /discuss command and returns only the topic", () => {
    const event = telegramGroupEvent(update({ text: "/discuss Should we ship?", chat: { id: -100987 }, from: { id: 5, is_bot: false } }));
    expect(event.text).toBe("Should we ship?");
  });

  it("tolerates a bot-addressed /discuss@bot command", () => {
    const event = telegramGroupEvent(update({ text: "/discuss@hermes_bot Argue about caching.", chat: { id: -100987 }, from: { id: 5 } }));
    expect(event.text).toBe("Argue about caching.");
  });

  it("drops bot traffic so agents never answer each other into a loop", () => {
    const event = update({ text: "/discuss loop?", chat: { id: -100987 }, from: { id: 9, is_bot: true } });
    expect(() => telegramGroupEvent(event)).toThrow(ChannelError);
    try { telegramGroupEvent(event); } catch (error) {
      expect((error as ChannelError).status).toBe(202);
    }
  });

  it("drops plain group chatter that is not a /discuss command", () => {
    expect(() => telegramGroupEvent(update({ text: "hello everyone", chat: { id: -100987 }, from: { id: 5 } }))).toThrow(ChannelError);
  });
});
