// Firebase Cloud Function: WhatsApp webhook for the Savoy bot.
// Works with 360dialog (default) or Meta's Cloud API directly; both send the same payloads.
// GET  = Meta's one-time webhook verification (Meta only)
// POST = incoming messages → Claude (+ Arbox tools) → WhatsApp reply
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { createArbox, pickBestUser } from "./src/arbox.js";
import { createWhatsApp, parseIncoming, parseStaffEchoes, webhookTokenOk } from "./src/whatsapp.js";
import { buildSystemPrompt, handleMessage } from "./src/agent.js";

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const ARBOX_API_KEY = defineSecret("ARBOX_API_KEY");
// 360dialog: the D360 API key. Meta: a permanent system-user access token.
const WHATSAPP_TOKEN = defineSecret("WHATSAPP_TOKEN");
// A random string you make up; the webhook URL must end with ?token=<this>.
const WEBHOOK_TOKEN = defineSecret("WEBHOOK_TOKEN");
const WHATSAPP_PROVIDER = defineString("WHATSAPP_PROVIDER", { default: "360dialog" });
// Meta only.
const WHATSAPP_PHONE_NUMBER_ID = defineString("WHATSAPP_PHONE_NUMBER_ID", { default: "" });
// Comma-separated staff numbers (e.g. 972521234567) that get handoff alerts.
const STAFF_PHONES = defineString("STAFF_PHONES", { default: "" });
const HANDOFF_HOURS = defineString("HANDOFF_HOURS", { default: "4" });

initializeApp();
const db = getFirestore();

const SESSION_IDLE_MS = 6 * 60 * 60 * 1000; // new conversation after 6h of silence
const MAX_HISTORY = 60; // messages; start fresh beyond this to keep documents small
const MEMBER_REFRESH_MS = 12 * 60 * 60 * 1000;
// A staff reply from the phone pauses the bot only inside a live chat, so that
// automatic messages (e.g. Arbox reminders from a linked device) don't silence it.
const LIVE_CHAT_MS = 30 * 60 * 1000;

function loadGymInfo() {
  const raw = readFileSync(new URL("./gym-info.md", import.meta.url), "utf8");
  return raw
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .filter((l) => !l.includes("TODO"))
    .join("\n")
    .trim();
}
const SYSTEM = buildSystemPrompt(loadGymInfo());

// Messages from the same person are handled one at a time (maxInstances: 1 below).
const queues = new Map();
function enqueue(key, job) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.then(job, job).finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
  queues.set(key, next);
  return next;
}

async function identify(arbox, phone, whatsappName, cached) {
  if (cached && Date.now() - (cached.checkedAt || 0) < MEMBER_REFRESH_MS) return { ...cached, whatsappName };
  let arboxUser = null;
  try {
    const u = pickBestUser(await arbox.findUsersByPhone(phone));
    if (u) arboxUser = { userId: u.user_id, firstName: u.first_name, lastName: u.last_name || "", role: u.user_role || u.user_type || null, active: u.active };
  } catch (err) {
    logger.warn("Arbox lookup failed", { err: err.message });
    if (cached) return { ...cached, whatsappName }; // keep the last known identity
  }
  return { arbox: arboxUser, whatsappName, checkedAt: Date.now() };
}

async function getWorkout(date) {
  const snap = await db.doc(`wods/${date}`).get();
  if (!snap.exists) return null;
  const { title, parts } = snap.data();
  return { title, parts: (parts || []).map(({ label, name, type, description }) => ({ label, name, type, description })) };
}

async function processMessage(msg, deps) {
  const { arbox, wa, client } = deps;
  const convRef = db.doc(`botConversations/${msg.from}`);
  const snap = await convRef.get();
  const conv = snap.exists ? snap.data() : {};

  if (conv.handoffUntil && conv.handoffUntil.toMillis() > Date.now()) {
    logger.info("In human mode, bot stays quiet", { from: msg.from });
    await convRef.set({ lastMessageAt: FieldValue.serverTimestamp() }, { merge: true });
    return;
  }

  wa.markReadAndTyping(msg.id);

  let state = conv.stateJson ? JSON.parse(conv.stateJson) : null;
  const idle = !conv.lastMessageAt || Date.now() - conv.lastMessageAt.toMillis() > SESSION_IDLE_MS;
  if (!state || idle || state.messages.length > MAX_HISTORY) state = { messages: [], pending: [] };

  const member = await identify(arbox, msg.from, msg.name, conv.member);
  const staff = STAFF_PHONES.value().split(",").map((s) => s.trim()).filter(Boolean);
  const who = member.arbox ? `${member.arbox.firstName} ${member.arbox.lastName}`.trim() : msg.name || "לא מזוהה";

  const { handoff } = await handleMessage(state, msg.text, {
    client,
    arbox,
    member,
    system: SYSTEM,
    getWorkout,
    send: (reply) => wa.send(msg.from, reply),
    notifyStaff: async (summary) => {
      await db.collection("botHandoffs").add({ phone: msg.from, who, summary, createdAt: FieldValue.serverTimestamp() });
      const text = `🔔 פנייה מהבוט\n${who} (+${msg.from})\n${summary}\nhttps://wa.me/${msg.from}`;
      await Promise.all(staff.map((p) => wa.send(p, { text }).catch((e) => logger.warn("staff alert failed", { e: e.message }))));
    },
  });

  const update = {
    stateJson: JSON.stringify(state),
    member,
    lastMessageAt: FieldValue.serverTimestamp(),
  };
  if (handoff) update.handoffUntil = new Date(Date.now() + Number(HANDOFF_HOURS.value()) * 3600 * 1000);
  await convRef.set(update, { merge: true });
}

export const whatsappWebhook = onRequest(
  {
    region: "europe-west1",
    maxInstances: 1,
    concurrency: 40,
    timeoutSeconds: 120,
    memory: "512MiB",
    secrets: [ANTHROPIC_API_KEY, ARBOX_API_KEY, WHATSAPP_TOKEN, WEBHOOK_TOKEN],
  },
  async (req, res) => {
    if (req.method === "GET") {
      const ok = req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === WEBHOOK_TOKEN.value();
      return ok ? res.status(200).send(req.query["hub.challenge"]) : res.sendStatus(403);
    }
    if (req.method !== "POST") return res.sendStatus(405);
    if (!webhookTokenOk(req, WEBHOOK_TOKEN.value())) {
      logger.warn("Webhook call without a valid token");
      return res.sendStatus(401);
    }

    const deps = {
      arbox: createArbox({ apiKey: ARBOX_API_KEY.value() }),
      wa: createWhatsApp({
        provider: WHATSAPP_PROVIDER.value(),
        token: WHATSAPP_TOKEN.value(),
        phoneNumberId: WHATSAPP_PHONE_NUMBER_ID.value(),
        baseUrl: process.env.WHATSAPP_BASE_URL || undefined,
      }),
      client: new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() }),
    };

    // Staff answered a customer from the phone: let the human take over.
    for (const phone of parseStaffEchoes(req.body)) {
      const ref = db.doc(`botConversations/${phone}`);
      const conv = (await ref.get()).data();
      if (conv?.lastMessageAt && Date.now() - conv.lastMessageAt.toMillis() < LIVE_CHAT_MS) {
        await ref.set({ handoffUntil: new Date(Date.now() + Number(HANDOFF_HOURS.value()) * 3600 * 1000) }, { merge: true });
        logger.info("Staff took over the chat", { phone });
      }
    }

    const jobs = parseIncoming(req.body).map(async (msg) => {
      // Meta retries webhooks; handle each message id once.
      try {
        await db.doc(`botProcessed/${msg.id}`).create({ at: FieldValue.serverTimestamp() });
      } catch {
        return;
      }
      await enqueue(msg.from, () =>
        processMessage(msg, deps).catch(async (err) => {
          logger.error("Failed to handle message", { from: msg.from, err: err.message, stack: err.stack });
          await deps.wa.send(msg.from, { text: "סליחה, יש לי תקלה רגעית. נסו שוב בעוד דקה 🙏" }).catch(() => {});
        }),
      );
    });
    await Promise.all(jobs);
    res.sendStatus(200);
  },
);
