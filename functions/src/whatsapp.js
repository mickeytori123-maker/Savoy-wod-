// WhatsApp Business Cloud API (Meta): parse webhooks, send replies.
import crypto from "node:crypto";

const GRAPH = "https://graph.facebook.com/v23.0";

// WhatsApp limits for interactive messages.
const LIMITS = { body: 1024, buttonTitle: 20, maxButtons: 3, rowTitle: 24, rowDesc: 72, maxRows: 10, listButton: 20, text: 4096 };

const clip = (s, n) => {
  s = String(s ?? "").trim();
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
};

/** Verify Meta's X-Hub-Signature-256 header against the raw request body. */
export function verifySignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret) return true; // not configured (local testing only)
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const got = signatureHeader.slice(7);
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

/**
 * Turn a webhook payload into a list of incoming messages:
 * { id, from, name, text } — button/list taps become text the model can read.
 */
export function parseIncoming(payload) {
  const out = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const names = Object.fromEntries((value.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of value.messages || []) {
        let text = null;
        if (m.type === "text") text = m.text?.body;
        else if (m.type === "interactive") {
          const r = m.interactive?.button_reply || m.interactive?.list_reply;
          if (r) text = `[בחר באפשרות: "${r.title}" | id=${r.id}]`;
        } else if (m.type === "button") text = m.button?.text;
        else text = `[המשתמש שלח הודעה מסוג ${m.type} שהבוט לא יודע לקרוא]`;
        if (text) out.push({ id: m.id, from: m.from, name: names[m.from] || null, text, phoneNumberId: value.metadata?.phone_number_id });
      }
    }
  }
  return out;
}

/** Build the WhatsApp message object for a reply with optional choices. */
export function buildReply(to, { text, options = [], listButton = "אפשרויות" }) {
  const body = clip(text, options.length ? LIMITS.body : LIMITS.text);
  const opts = options.slice(0, LIMITS.maxRows).map((o, i) => ({
    id: clip(o.id || `opt_${i + 1}`, 200),
    title: o.title,
    description: o.description,
  }));
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };

  if (!opts.length) return { ...base, type: "text", text: { body, preview_url: true } };

  const fitsButtons = opts.length <= LIMITS.maxButtons && opts.every((o) => !o.description && o.title.length <= LIMITS.buttonTitle);
  if (fitsButtons) {
    return {
      ...base,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: body },
        action: { buttons: opts.map((o) => ({ type: "reply", reply: { id: o.id, title: clip(o.title, LIMITS.buttonTitle) } })) },
      },
    };
  }
  return {
    ...base,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: body },
      action: {
        button: clip(listButton, LIMITS.listButton),
        sections: [
          {
            title: clip(listButton, LIMITS.rowTitle),
            rows: opts.map((o) => ({
              id: o.id,
              title: clip(o.title, LIMITS.rowTitle),
              ...(o.description ? { description: clip(o.description, LIMITS.rowDesc) } : {}),
            })),
          },
        ],
      },
    },
  };
}

export function createWhatsApp({ token = process.env.WHATSAPP_TOKEN, phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID, fetchImpl = fetch } = {}) {
  async function post(body) {
    const res = await fetchImpl(`${GRAPH}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`WhatsApp send failed: HTTP ${res.status} ${await res.text()}`);
    return res.json();
  }
  return {
    send: (to, reply) => post(buildReply(to, reply)),
    /** Blue ticks + "typing…" while the bot thinks. Best effort. */
    markReadAndTyping: (messageId) =>
      post({ messaging_product: "whatsapp", status: "read", message_id: messageId, typing_indicator: { type: "text" } }).catch(() => {}),
  };
}
