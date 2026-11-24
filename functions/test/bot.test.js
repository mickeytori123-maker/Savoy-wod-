import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { toLocalIsraeliPhone, pickBestUser, simplifyClass } from "../src/arbox.js";
import { buildReply, parseIncoming, verifySignature } from "../src/whatsapp.js";
import { handleMessage, contextLine } from "../src/agent.js";

test("phone numbers normalise to Israeli local format", () => {
  assert.equal(toLocalIsraeliPhone("972521234567"), "0521234567");
  assert.equal(toLocalIsraeliPhone("+972-52-123-4567"), "0521234567");
  assert.equal(toLocalIsraeliPhone("0521234567"), "0521234567");
});

test("pickBestUser prefers an active member over a lead", () => {
  const u = pickBestUser([
    { user_id: 1, user_role: "lead", active: 1 },
    { user_id: 2, user_role: "user", active: 1 },
  ]);
  assert.equal(u.user_id, 2);
  assert.equal(pickBestUser([]), null);
});

test("simplifyClass drops coach contact details", () => {
  const c = simplifyClass({ schedule_id: 9, date: "2026-11-25", start_time: "07:30", end_time: "08:30", session_name: "CrossFit", staff_member: { name: "Coach", email: "x@y", phone: "1" }, registration_link: "http://l" });
  assert.equal(c.coach, "Coach");
  assert.ok(!JSON.stringify(c).includes("x@y"));
});

test("up to 3 short options become buttons", () => {
  const r = buildReply("972500000000", { text: "מה תרצה?", options: [{ id: "a", title: "מערכת שעות" }, { id: "b", title: "המנוי שלי" }] });
  assert.equal(r.interactive.type, "button");
  assert.equal(r.interactive.action.buttons.length, 2);
});

test("many options become a list, titles clipped to WhatsApp limits", () => {
  const options = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, title: `שיעור CrossFit מספר ${i} עם כותרת ארוכה`, description: "x".repeat(100) }));
  const r = buildReply("972500000000", { text: "בחר שיעור", options });
  assert.equal(r.interactive.type, "list");
  const rows = r.interactive.action.sections[0].rows;
  assert.equal(rows.length, 10);
  assert.ok(rows.every((row) => row.title.length <= 24 && row.description.length <= 72));
});

test("no options sends plain text", () => {
  assert.equal(buildReply("1", { text: "שלום" }).type, "text");
});

test("parseIncoming reads text and button taps", () => {
  const payload = {
    entry: [{ changes: [{ value: {
      metadata: { phone_number_id: "P" },
      contacts: [{ wa_id: "972500000000", profile: { name: "דנה" } }],
      messages: [
        { id: "m1", from: "972500000000", type: "text", text: { body: "היי" } },
        { id: "m2", from: "972500000000", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "class_1", title: "07:30" } } },
      ],
    } }] }],
  };
  const msgs = parseIncoming(payload);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].name, "דנה");
  assert.match(msgs[1].text, /id=class_1/);
  assert.deepEqual(parseIncoming({ entry: [{ changes: [{ value: { statuses: [{}] } }] }] }), []);
});

test("webhook signature check", () => {
  const body = Buffer.from('{"a":1}');
  const sig = "sha256=" + crypto.createHmac("sha256", "s3cret").update(body).digest("hex");
  assert.equal(verifySignature(body, sig, "s3cret"), true);
  assert.equal(verifySignature(body, sig, "other"), false);
  assert.equal(verifySignature(body, undefined, "s3cret"), false);
});

test("contextLine names identified members and gives the date", () => {
  const line = contextLine({ arbox: { firstName: "מיקי", lastName: "ט", role: "user" } }, new Date("2026-11-24T18:00:00Z"));
  assert.match(line, /מיקי/);
  assert.match(line, /2026-11-24/);
  assert.match(contextLine({ arbox: null, whatsappName: "Dana" }), /unidentified.*Dana/);
});

// --- agent loop with a scripted model ---

function scriptedClient(responses) {
  const calls = [];
  return {
    calls,
    beta: { messages: { create: async (params) => { calls.push(structuredClone(params)); return responses.shift(); } } },
  };
}
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });

test("agent looks up the schedule, replies with options, and carries results to the next turn", async () => {
  const client = scriptedClient([
    { stop_reason: "tool_use", content: [toolUse("t1", "get_schedule", { from_date: "2026-11-25", to_date: "2026-11-25" })] },
    { stop_reason: "tool_use", content: [toolUse("t2", "reply", { text: "היי מיקי! מחר:", options: [{ id: "class_1", title: "07:30 CrossFit" }] })] },
    { stop_reason: "tool_use", content: [toolUse("t3", "reply", { text: "הנה הלינק: http://l" })] },
  ]);
  const sent = [];
  const arbox = { getSchedule: async () => [{ schedule_id: 1, date: "2026-11-25", start_time: "07:30", end_time: "08:30", session_name: "CrossFit", registration_link: "http://l" }] };
  const ctx = { client, arbox, member: { arbox: { userId: 5, firstName: "מיקי" } }, system: "sys", send: async (r) => sent.push(r) };
  const state = { messages: [], pending: [] };

  await handleMessage(state, "מה יש מחר?", ctx);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].options[0].id, "class_1");
  assert.equal(state.pending.length, 1);
  // the schedule result went back to the model
  assert.match(JSON.stringify(client.calls[1].messages.at(-1)), /07:30/);

  await handleMessage(state, '[בחר באפשרות: "07:30 CrossFit" | id=class_1]', ctx);
  const lastUser = client.calls[2].messages.at(-1);
  assert.equal(lastUser.content[0].type, "tool_result");
  assert.equal(lastUser.content[0].tool_use_id, "t2");
  assert.equal(sent[1].text, "הנה הלינק: http://l");
  // roles alternate
  const roles = state.messages.map((m) => m.role);
  for (let i = 1; i < roles.length; i++) assert.notEqual(roles[i], roles[i - 1]);
});

test("handoff notifies staff and marks the conversation", async () => {
  const client = scriptedClient([
    { stop_reason: "tool_use", content: [toolUse("h", "handoff_to_human", { summary: "רוצה להקפיא מנוי" }), toolUse("r", "reply", { text: "העברתי לצוות" })] },
  ]);
  const staff = [];
  const res = await handleMessage({ messages: [], pending: [] }, "אני רוצה להקפיא", {
    client, arbox: {}, member: null, system: "s", send: async () => {}, notifyStaff: async (s) => staff.push(s),
  });
  assert.deepEqual(staff, ["רוצה להקפיא מנוי"]);
  assert.equal(res.handoff, true);
});

test("tool errors are reported to the model, not thrown", async () => {
  const client = scriptedClient([
    { stop_reason: "tool_use", content: [toolUse("t1", "get_my_memberships", {})] },
    { stop_reason: "tool_use", content: [toolUse("t2", "reply", { text: "לא הצלחתי לבדוק כרגע" })] },
  ]);
  const arbox = { getUserMemberships: async () => { throw new Error("Arbox down"); } };
  await handleMessage({ messages: [], pending: [] }, "מתי נגמר המנוי?", {
    client, arbox, member: { arbox: { userId: 1, firstName: "a" } }, system: "s", send: async () => {},
  });
  const result = client.calls[1].messages.at(-1).content[0];
  assert.equal(result.is_error, true);
  assert.match(result.content, /Arbox down/);
});

test("refusal sends a safe message and hands off", async () => {
  const client = scriptedClient([{ stop_reason: "refusal", content: [] }]);
  const sent = [];
  const res = await handleMessage({ messages: [], pending: [] }, "...", { client, arbox: {}, member: null, system: "s", send: async (r) => sent.push(r) });
  assert.equal(res.handoff, true);
  assert.equal(sent.length, 1);
});

// --- providers ---
import { providerEndpoint, webhookTokenOk } from "../src/whatsapp.js";

test("360dialog sends to its own endpoint with the D360 key", () => {
  const e = providerEndpoint({ provider: "360dialog", token: "k" });
  assert.equal(e.url, "https://waba-v2.360dialog.io/messages");
  assert.deepEqual(e.headers, { "D360-API-KEY": "k" });
});

test("Meta sends to the Graph API with a bearer token", () => {
  const e = providerEndpoint({ provider: "meta", token: "t", phoneNumberId: "123" });
  assert.match(e.url, /graph\.facebook\.com\/v\d+\.\d+\/123\/messages$/);
  assert.equal(e.headers.Authorization, "Bearer t");
  assert.throws(() => providerEndpoint({ provider: "other" }));
});

test("webhook requires the shared token", () => {
  const req = (q, h = {}) => ({ query: q, get: (n) => h[n] });
  assert.equal(webhookTokenOk(req({ token: "abc" }), "abc"), true);
  assert.equal(webhookTokenOk(req({}, { "x-webhook-token": "abc" }), "abc"), true);
  assert.equal(webhookTokenOk(req({ token: "abd" }), "abc"), false);
  assert.equal(webhookTokenOk(req({}), "abc"), false);
  assert.equal(webhookTokenOk(req({ token: "" }), ""), false);
});

test("createWhatsApp posts the Cloud API body to the provider", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({}) }; };
  const { createWhatsApp } = await import("../src/whatsapp.js");
  const wa = createWhatsApp({ provider: "360dialog", token: "k", fetchImpl });
  await wa.send("972500000000", { text: "שלום" });
  assert.equal(calls[0].url, "https://waba-v2.360dialog.io/messages");
  assert.equal(calls[0].init.headers["D360-API-KEY"], "k");
  assert.equal(JSON.parse(calls[0].init.body).text.body, "שלום");
});

test("staff echoes (coexistence) are detected, customer messages are not", async () => {
  const { parseStaffEchoes } = await import("../src/whatsapp.js");
  const payload = { entry: [{ changes: [
    { field: "smb_message_echoes", value: { message_echoes: [{ from: "972511111111", to: "972500000000", type: "text", text: { body: "אני מטפל" } }] } },
    { field: "messages", value: { messages: [{ id: "x", from: "972522222222", type: "text", text: { body: "hi" } }] } },
  ] }] };
  assert.deepEqual(parseStaffEchoes(payload), ["972500000000"]);
});
