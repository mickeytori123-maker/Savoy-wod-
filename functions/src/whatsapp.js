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

/**
 * Coexistence: messages the staff send from the WhatsApp Business app (or a linked
 * device) arrive as "smb_message_echoes". Returns the customer numbers they went to.
 */
export function parseStaffEchoes(payload) {
  const out = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== "smb_message_echoes") continue;
      for (const m of change.value?.message_echoes || []) if (m.to) out.push(m.to);
    }
  }
  return [...new Set(out)];
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

/** Where to send messages and how to authenticate, per provider. Both use Meta's Cloud API message format. */
export function providerEndpoint({ provider = "360dialog", token, phoneNumberId, baseUrl }) {
  if (provider === "360dialog") {
    return {
      url: `${baseUrl || "https://waba-v2.360dialog.io"}/messages`,
      headers: { "D360-API-KEY": token },
    };
  }
  if (provider === "meta") {
    return { url: `${baseUrl || GRAPH}/${phoneNumberId}/messages`, headers: { Authorization: `Bearer ${token}` } };
  }
  throw new Error(`Unknown WhatsApp provider "${provider}" (use "360dialog" or "meta")`);
}

/** Webhook auth: the callback URL carries ?token=<secret> (works for both providers). */
export function webhookTokenOk(req, secret) {
  const got = String(req.query?.token || req.get?.("x-webhook-token") || "");
  return Boolean(secret) && got.length === secret.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(secret));
}

export function createWhatsApp({ provider, token, phoneNumberId, baseUrl, fetchImpl = fetch } = {}) {
  const endpoint = providerEndpoint({ provider, token, phoneNumberId, baseUrl });
  async function post(body) {
    const res = await fetchImpl(endpoint.url, {
      method: "POST",
      headers: { ...endpoint.headers, "Content-Type": "application/json" },
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
