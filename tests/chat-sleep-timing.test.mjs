import assert from "node:assert/strict";
import test from "node:test";
import { messageTiming } from "../lib/chat-timing.ts";
import { reviewSleepReply } from "../lib/chat-grounding.ts";

const received = Date.parse("2026-11-19T00:52:19.424+08:00");
const woke = Date.parse("2026-11-19T04:13:45.137+08:00");
const read = Date.parse("2026-11-19T04:13:46.292+08:00");
const awake = { mode: "awake", wokeAt: woke };
const interval = { made: Date.parse("2026-11-18T20:48:45.137+08:00"), until: woke, wakeCause: "natural_wake" };
const line = { made: received, handled_at: null };
const poke = { text: "（戳", timing: messageTiming(line, awake, read, "asleep", [interval]) };
const newMessage = { text: "我四点刚醒。", timing: messageTiming({ ...line, made: woke + 500 }, awake, read, "asleep", [interval]) };
const noReview = () => assert.fail("unexpected timing review");

test("the overnight note belongs to the individual QQ message", () => {
  assert.equal(poke.timing.receivedAt, "2026-11-19T00:52");
  assert.equal(poke.timing.readAt, "2026-11-19T04:13");
  assert.equal(poke.timing.delayMinutes, 201);
  assert.match(poke.timing.afterSleep, /00:52 留言.*04:13 自然醒来.*04:13 才读到/);
  assert.equal(newMessage.timing.receivedMode, "awake");
  assert.equal(newMessage.timing.afterSleep, undefined);
});

test("only witnessed wake causes appear in a late receipt, including across midnight", () => {
  const previousDate = { ...line, made: Date.parse("2026-11-18T23:50:00+08:00") };
  const alarm = messageTiming(previousDate, awake, read, undefined, [{ ...interval, wakeCause: "alarm_wake" }]);
  assert.match(alarm.afterSleep, /11-18T23:50 留言.*11-19T04:13 听到闹钟醒来/);
  const hiddenCause = messageTiming(line, awake, read, undefined, [{ ...interval, wakeCause: null }]);
  assert.match(hiddenCause.afterSleep, /04:13 醒来/);
  assert.doesNotMatch(hiddenCause.afterSleep, /自然|闹钟/);
  assert.match(messageTiming(line, awake, read, "asleep", []).afterSleep, /你后来醒了/);
  assert.equal(messageTiming(line, awake, read, undefined, []).afterSleep, undefined);
});

test("an interaction actually read in bed can wake her, and historical reads keep their own time", () => {
  const asleep = { mode: "asleep" };
  const handling = received + 5000;
  const interaction = messageTiming(line, asleep, handling, "asleep", [{ made: interval.made, until: handling + 1 }]);
  assert.equal(interaction.receivedMode, "asleep");
  assert.equal(interaction.afterSleep, undefined);
  const old = messageTiming({ ...line, handled_at: handling }, awake, read, "asleep", [interval]);
  assert.equal(old.readAt, "2026-11-19T00:52");
  assert.equal(old.afterSleep, undefined);
});

test("review all bubbles together, correct the later question and preserve the first bubble and actions", async () => {
  const result = { decision: "send", messages: ["我四点才读到～",
    "说好的事我记着，不过这都半夜了，主人是自己还醒着，还是也刚醒呀？"], voice: true };
  const checked = await reviewSleepReply([poke], result, async input => {
    assert.deepEqual(input.unread, [poke]);
    assert.deepEqual(input.bubbles.map(b => b.map(c => c.text).join("")), result.messages);
    // Even an overbroad review cannot discard the unrelated reminder in clause 2.
    return { omit: [2, 3, 4, 5], sleepAction: "wake" };
  });
  assert.deepEqual(checked, { decision: "send", messages: [result.messages[0], "说好的事我记着。"], voice: true, grounding: "message_timing" });
  assert.match(result.messages[1], /还是也刚醒/);
});

test("even an approving reviewer cannot send unsupported present-tense or wake claims in a delayed turn", async () => {
  const draft = { messages: ["我四点才看到。", "不过这都半夜了，主人是自己还醒着，还是也刚醒呀？", "这会儿又来戳我？", "（被戳醒了）"] };
  const checked = await reviewSleepReply([poke], draft, async () => ({ omit: [] }));
  assert.deepEqual(checked.messages, [draft.messages[0]]);
  const valid = { messages: ["你零点还醒着呀。我不是被你戳醒的，是自己睡醒才看到。", "要是现在戳我，我就戳回去～", "你留言的时候，你还醒着。", "我刚才是做梦，还是没睡？"] };
  assert.equal(await reviewSleepReply([poke], valid, async () => ({ omit: [] })), valid);
});

test("a new current message supplies its own evidence in a mixed batch or a separate turn", async () => {
  const result = { decision: "send", messages: ["我四点才看到你零点那一戳～", "原来你现在也刚醒呀。"] };
  assert.equal(await reviewSleepReply([poke, newMessage], result, async ({ unread }) => {
    assert.deepEqual(unread.map(p => p.timing.receivedAt), ["2026-11-19T00:52", "2026-11-19T04:13"]);
    return { omit: [2] };
  }), result);
  assert.equal(await reviewSleepReply([newMessage], result, noReview), result);
  const wrongGesture = { messages: [...result.messages, "你四点来戳我。"] };
  assert.deepEqual((await reviewSleepReply([poke, newMessage], wrongGesture, async () => ({ omit: [] }))).messages, result.messages);
});

test("an explicit reading hour cannot be assigned to the sender, in words or digits", async () => {
  const result = { messages: ["你凌晨四点来戳我。", "你在04:13给我发的这条消息。", "你零点来戳我，我四点才看到。"] };
  const checked = await reviewSleepReply([poke], result, async () => ({ omit: [] }));
  assert.deepEqual(checked.messages, [result.messages[2]]);
});

test("a wake-up stage direction can be removed without losing the dialogue after it", async () => {
  const draft = { messages: ["（被戳得一个激灵醒过来）我四点才看到你的留言～"] };
  const checked = await reviewSleepReply([poke], draft, async () => ({ omit: [] }));
  assert.deepEqual(checked.messages, ["我四点才看到你的留言～"]);
});

test("silence, media-only replies and immediate interactions keep their existing behavior", async () => {
  for (const result of [{ decision: "silent" }, { decision: "send", reuse: "sticker" }])
    assert.equal(await reviewSleepReply([poke], result, noReview), result);
  const immediate = { text: "*戳", timing: { receivedMode: "asleep" } };
  const reaction = { decision: "send", text: "被戳醒了～", sleepAction: "wake" };
  assert.equal(await reviewSleepReply([immediate], reaction, noReview), reaction);
});

test("legacy text is editable and invalid edits never partially change a reply", async () => {
  const original = { decision: "send", text: "被你戳醒了。" };
  assert.equal((await reviewSleepReply([poke], original, async () => ({ omit: [1] }))).text, "我睡醒才看到你之前的留言～");
  for (const invalid of [{}, { omit: [0] }, { omit: [1, 2] }])
    await assert.rejects(reviewSleepReply([poke], original, async () => invalid));
  assert.equal(original.text, "被你戳醒了。");
});
