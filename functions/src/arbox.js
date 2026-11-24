// Thin client for the Arbox Public API v3 (only the endpoints the bot uses).
// Verified against the Savoy account: /locations, /schedule, /users/searchUser,
// /users/memberships, /membershipTypes.

const BASE_URL = process.env.ARBOX_BASE_URL || "https://arboxserver.arboxapp.com/api/public/v3";
// Arbox expects the key in a header; the name is configurable in case your
// account's docs say otherwise.
const KEY_HEADER = process.env.ARBOX_API_KEY_HEADER || "apiKey";

export class ArboxError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createArbox({ apiKey = process.env.ARBOX_API_KEY, fetchImpl = fetch } = {}) {
  async function get(path, params = {}) {
    const url = new URL(BASE_URL + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const headers = { Accept: "application/json" };
    if (apiKey) headers[KEY_HEADER] = apiKey;
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ArboxError(`Arbox ${path}: non-JSON response (HTTP ${res.status})`, res.status);
    }
    if (!res.ok || (body.statusCode && body.statusCode >= 400)) {
      const msg = typeof body.error?.message === "string" ? body.error.message : JSON.stringify(body.error);
      throw new ArboxError(`Arbox ${path}: ${msg}`, res.status);
    }
    return body.data;
  }

  return {
    /** All users (members, staff, leads) whose phone matches, any format. */
    async findUsersByPhone(phone) {
      const local = toLocalIsraeliPhone(phone);
      const data = await get("/users/searchUser", { type: "phone", value: local });
      return Array.isArray(data) ? data : [];
    },

    /** Classes between two dates (YYYY-MM-DD, inclusive). */
    async getSchedule(fromDate, toDate) {
      const data = await get("/schedule", { from_date: fromDate, to_date: toDate });
      return Array.isArray(data) ? data : [];
    },

    async getUserMemberships(userId) {
      const data = await get("/users/memberships", { user_id: userId });
      return Array.isArray(data) ? data : [];
    },

    async getMembershipTypes() {
      const data = await get("/membershipTypes");
      return Array.isArray(data) ? data : [];
    },
  };
}

/** "972521234567" / "+972-52-123-4567" / "0521234567" -> "0521234567". */
export function toLocalIsraeliPhone(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("972")) digits = digits.slice(3);
  if (digits && !digits.startsWith("0")) digits = "0" + digits;
  return digits;
}

/**
 * Pick the person behind a WhatsApp number. A phone can match several Arbox
 * records (e.g. a member and an old lead); prefer active non-lead records.
 */
export function pickBestUser(users) {
  if (!users.length) return null;
  const score = (u) => {
    const role = String(u.user_role || u.user_type || "").toLowerCase();
    let s = 0;
    if (role && role !== "lead") s += 2;
    if (u.active === 1 || u.active === true) s += 1;
    if (u.deleted_at) s -= 5;
    return s;
  };
  return [...users].sort((a, b) => score(b) - score(a))[0];
}

/** Keep only what the model needs, to save tokens and avoid leaking staff contact details. */
export function simplifyClass(c) {
  return {
    schedule_id: c.schedule_id,
    date: c.date,
    start: c.start_time,
    end: c.end_time,
    name: c.session_name,
    coach: c.staff_member?.name || null,
    max_participants: c.max_participants,
    cancel_until_hours_before: c.disable_cancellation_time,
    registration_link: c.registration_link,
    note: c.note || undefined,
  };
}

export function simplifyMembership(m) {
  return {
    name: m.membership_type_name,
    type: m.type,
    start: m.start_time,
    end: m.end_time,
    active: m.active === 1 || m.active === true,
    cancelled: Boolean(m.cancelled),
    debt: m.debt || 0,
  };
}

export function simplifyMembershipType(t) {
  return {
    name: t.membership_type_name,
    description: t.description || undefined,
    type: t.type,
    price: t.price,
    sessions: t.sessions || undefined,
    period: t.period_amount ? `${t.period_amount} ${t.period_time_unit}` : undefined,
    recurring: Boolean(t.is_recurring_payment),
    purchase_link: t.link,
  };
}
