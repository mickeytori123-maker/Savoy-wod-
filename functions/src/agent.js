// The bot's brain: Claude + tools that read Arbox / the WOD app, and a
// `reply` tool that sends a WhatsApp message with clickable choices.
import Anthropic from "@anthropic-ai/sdk";
import { simplifyClass, simplifyMembership, simplifyMembershipType } from "./arbox.js";

export const MODEL = process.env.BOT_MODEL || "claude-opus-5-5";
// Short chat replies don't need deep thinking; raise to "medium" if answers feel shallow.
export const EFFORT = process.env.BOT_EFFORT || "low";
const MAX_STEPS = 8;
// Plan names (or parts of names) never offered to customers, comma-separated.
const HIDDEN_PLANS = (process.env.BOT_HIDDEN_PLANS || "צוות").split(",").map((s) => s.trim()).filter(Boolean);
const TZ = "Asia/Jerusalem";

export const TOOLS = [
  {
    name: "reply",
    description:
      "Send the WhatsApp reply to the member. Use this for EVERY answer. When the member has a choice to make " +
      "(which class, which plan, what to do next), include `options` so they can tap instead of typing. " +
      "Up to 3 short options (title ≤ 20 chars, no description) show as buttons; more, or options with a " +
      "description, show as a list (max 10, title ≤ 24 chars, description ≤ 72 chars). After calling this, stop.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Message body, WhatsApp style: short, friendly, *bold* allowed, links allowed." },
        options: {
          type: "array",
          maxItems: 10,
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Machine id you will recognise when tapped, e.g. class_57935538, plan_121645, menu_schedule." },
              title: { type: "string" },
              description: { type: "string" },
            },
            required: ["id", "title"],
            additionalProperties: false,
          },
        },
        list_button: { type: "string", description: "Label of the list-open button (≤ 20 chars), e.g. 'בחירת שיעור'." },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "get_schedule",
    description:
      "Class schedule from Arbox for a date range (inclusive, max 14 days). Returns each class's time, type, coach, " +
      "max participants, cancellation window and its registration_link (send that link so the member can book).",
    input_schema: {
      type: "object",
      properties: {
        from_date: { type: "string", description: "YYYY-MM-DD" },
        to_date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["from_date", "to_date"],
      additionalProperties: false,
    },
  },
  {
    name: "get_my_memberships",
    description: "The current member's memberships in Arbox: plan name, start/end dates, active, debt. Only works for an identified member.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_membership_types",
    description:
      "Plans and services the gym sells, with prices and a purchase link. Filter by kind: plan = monthly membership, " +
      "session = punch card, trial = trial class, service = personal training etc., workshop, item = products.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["plan", "session", "trial", "service", "workshop", "item"] },
      },
      required: ["kind"],
      additionalProperties: false,
    },
  },
  {
    name: "get_workout",
    description: "The published workout (WOD) for a date from the Savoy WOD app, if the coaches have posted it.",
    input_schema: {
      type: "object",
      properties: { date: { type: "string", description: "YYYY-MM-DD" } },
      required: ["date"],
      additionalProperties: false,
    },
  },
  {
    name: "handoff_to_human",
    description:
      "Hand the conversation to the gym staff: the member asked for a person, wants to cancel/freeze/change a membership, " +
      "has a payment or medical issue, is upset, or you can't help. Staff get notified and the bot goes quiet for this " +
      "member for a few hours. Then call `reply` to tell the member someone will get back to them.",
    input_schema: {
      type: "object",
      properties: { summary: { type: "string", description: "One or two lines for the staff: who, what they need." } },
      required: ["summary"],
      additionalProperties: false,
    },
  },
];

export function buildSystemPrompt(gymInfo) {
  return `You are the WhatsApp assistant of CrossFit Savoy, a CrossFit gym in Tel Aviv. You talk with members and people interested in joining.

How to behave:
- Write in the member's language (usually Hebrew). Short WhatsApp messages, warm and to the point, at most one or two emojis.
- Address identified members by first name.
- Work out what the person wants. When there is a choice to make, offer it as options (the \`reply\` tool's \`options\`) so they can tap. If the request is unclear, offer the most likely choices rather than asking an open question.
- Always answer through the \`reply\` tool, exactly once per turn, then stop.
- Use the tools for any fact about classes, plans, prices or memberships. Never invent times, prices or dates. If a tool fails, say you couldn't check right now and offer to pass it to the team.
- Booking: you cannot book or cancel in Arbox yourself. To book, send the class's registration_link (and mention the cancellation window). To cancel a booking, tell them to cancel in the Arbox app; if they can't, hand off to staff.
- Membership changes, freezes, cancellations, refunds, payment problems, injuries/medical questions, complaints, or an explicit request for a person: use \`handoff_to_human\`, then reply.
- Only discuss the identified sender's own personal data. Never reveal other members' details.
- An unidentified number is a prospect: be welcoming, explain the gym, offer a trial class, and use \`handoff_to_human\` with their name and interest so staff can follow up.
- Tapped options arrive as [בחר באפשרות: "title" | id=...]; treat that as their answer.
- Dates: each message starts with the current date and time in Israel. "Tomorrow", "Sunday" and so on are relative to that. Israeli weeks start on Sunday.

Gym information (from the owner; trust it over general knowledge):
${gymInfo}`;
}

/** Context line prepended to each incoming message (kept out of the cached system prompt). */
export function contextLine(member, now = new Date()) {
  const when = new Intl.DateTimeFormat("he-IL", {
    timeZone: TZ, weekday: "long", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(now);
  const iso = isoDate(now);
  const who = member?.arbox
    ? `identified ${member.arbox.role || "member"}: ${member.arbox.firstName} ${member.arbox.lastName || ""}`.trim()
    : `unidentified number${member?.whatsappName ? ` (WhatsApp name: ${member.whatsappName})` : ""}`;
  return `[now: ${when} (${iso}) | sender: ${who}]`;
}

export function isoDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/** Run a non-reply tool. Returns a string for the tool_result. */
export async function runTool(name, input, ctx) {
  const { arbox, member, getWorkout, notifyStaff } = ctx;
  switch (name) {
    case "get_schedule": {
      const { from_date, to_date } = input;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from_date) || !/^\d{4}-\d{2}-\d{2}$/.test(to_date)) throw new Error("dates must be YYYY-MM-DD");
      if (daysBetween(from_date, to_date) > 14 || daysBetween(from_date, to_date) < 0) throw new Error("range must be 0–14 days");
      const classes = await arbox.getSchedule(from_date, to_date);
      const sorted = classes.map(simplifyClass).sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`));
      return JSON.stringify(sorted);
    }
    case "get_my_memberships": {
      if (!member?.arbox?.userId) return JSON.stringify({ error: "sender is not an identified member" });
      const ms = await arbox.getUserMemberships(member.arbox.userId);
      return JSON.stringify(ms.map(simplifyMembership));
    }
    case "get_membership_types": {
      const types = await arbox.getMembershipTypes();
      const offered = types.filter(
        (t) => (t.active === 1 || t.active === true) && t.type === input.kind && Number(t.price) > 0 && !HIDDEN_PLANS.some((h) => t.membership_type_name?.includes(h)),
      );
      return JSON.stringify(offered.map(simplifyMembershipType));
    }
    case "get_workout": {
      const wod = getWorkout ? await getWorkout(input.date) : null;
      return wod ? JSON.stringify(wod) : JSON.stringify({ result: "no workout published for this date" });
    }
    case "handoff_to_human": {
      await notifyStaff?.(input.summary);
      ctx.handoff = true;
      return JSON.stringify({ result: "staff notified" });
    }
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

/**
 * Handle one incoming message.
 * state: { messages: MessageParam[], pending: ToolResultBlockParam[] } (mutated and returned)
 * ctx: { client, arbox, member, getWorkout, notifyStaff, send(reply), system }
 */
export async function handleMessage(state, text, ctx) {
  const client = ctx.client || new Anthropic();
  const userContent = [...(state.pending || []), { type: "text", text: `${contextLine(ctx.member, ctx.now)}\n${text}` }];
  state.pending = [];
  state.messages.push({ role: "user", content: userContent });

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // if a safety classifier declines, the API retries on a fallback model
      output_config: { effort: EFFORT },
      cache_control: { type: "ephemeral" },
      system: ctx.system,
      tools: TOOLS,
      messages: state.messages,
    });
    state.messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "refusal") {
      await ctx.send({ text: "מצטער, אני לא יכול לעזור בזה כאן. אעביר את ההודעה לצוות 🙏" });
      await ctx.notifyStaff?.(`הבוט לא הצליח לענות להודעה: "${text.slice(0, 200)}"`);
      return { state, handoff: true };
    }

    const toolUses = response.content.filter((b) => b.type === "tool_use");
    if (!toolUses.length) {
      // Model answered in plain text instead of the reply tool: send it as-is.
      const plain = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      if (plain) await ctx.send({ text: plain });
      return { state, handoff: Boolean(ctx.handoff) };
    }

    const results = [];
    let replied = false;
    for (const tu of toolUses) {
      if (tu.name === "reply") {
        if (replied) {
          results.push({ type: "tool_result", tool_use_id: tu.id, content: "ignored: already replied this turn" });
          continue;
        }
        await ctx.send({ text: tu.input.text, options: tu.input.options || [], listButton: tu.input.list_button });
        replied = true;
        results.push({ type: "tool_result", tool_use_id: tu.id, content: "sent" });
        continue;
      }
      try {
        results.push({ type: "tool_result", tool_use_id: tu.id, content: await runTool(tu.name, tu.input, ctx) });
      } catch (err) {
        results.push({ type: "tool_result", tool_use_id: tu.id, content: `error: ${err.message}`, is_error: true });
      }
    }

    if (replied) {
      // Turn is over. The tool results go at the start of the next user message.
      state.pending = results;
      return { state, handoff: Boolean(ctx.handoff) };
    }
    state.messages.push({ role: "user", content: results });
  }

  // Out of steps: keep the last tool results for the next turn so roles keep alternating.
  const last = state.messages[state.messages.length - 1];
  if (last?.role === "user") state.pending = state.messages.pop().content;
  await ctx.send({ text: "סליחה, משהו השתבש אצלי. אפשר לנסות שוב, או לכתוב \"נציג\" ונחזור אליך 🙏" });
  return { state, handoff: Boolean(ctx.handoff) };
}
