// Syncs active Arbox clients into Firestore `members/{email}` so they can sign in.
// Runs hourly from GitHub Actions. Members added by hand in the app (source: "manual") are never removed.
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const API = "https://arboxserver.arboxapp.com/api/public/v3";
const KEY = process.env.ARBOX_API_KEY;
const ROLES = new Set(["client", "staffMember"]);
if (!KEY) { console.error("ARBOX_API_KEY is not set"); process.exit(1); }

async function fetchAllUsers() {
  const all = [];
  for (let page = 1; page < 200; page++) {
    const res = await fetch(`${API}/users?page=${page}`, { headers: { apiKey: KEY } });
    if (!res.ok) throw new Error(`Arbox users page ${page}: HTTP ${res.status}`);
    const body = await res.json();
    all.push(...(body.data || []));
    if (!body.extra?.pagination?.next_page_url) break;
  }
  return all;
}

const users = await fetchAllUsers();
const wanted = new Map();
for (const u of users) {
  const email = String(u.email || "").trim().toLowerCase();
  if (!email || !email.includes("@") || email.includes("/")) continue;
  if (String(u.active) !== "1" || !ROLES.has(u.user_role)) continue;
  wanted.set(email, { source: "arbox", arboxId: u.user_id, role: u.user_role, gender: ["male", "female"].includes(u.gender) ? u.gender : "" });
}

initializeApp({ credential: applicationDefault(), projectId: "savoy-wod" });
const db = getFirestore();
const existing = await db.collection("members").get();
const writer = db.bulkWriter();
let added = 0, updated = 0, removed = 0;
const seen = new Set();
for (const doc of existing.docs) {
  seen.add(doc.id);
  const d = doc.data();
  const w = wanted.get(doc.id);
  if (w) {
    if (d.source !== "arbox" || d.gender !== w.gender || d.arboxId !== w.arboxId || d.role !== w.role) { writer.set(doc.ref, { ...w, syncedAt: FieldValue.serverTimestamp() }, { merge: true }); updated++; }
  } else if (d.source === "arbox") { writer.delete(doc.ref); removed++; }
}
for (const [email, w] of wanted) {
  if (!seen.has(email)) { writer.set(db.collection("members").doc(email), { ...w, added: new Date().toISOString(), syncedAt: FieldValue.serverTimestamp() }); added++; }
}
await writer.close();
await db.doc("meta/sync").set({ lastRun: FieldValue.serverTimestamp(), activeMembers: wanted.size, added, updated, removed });
console.log(`Arbox users: ${users.length}, active members: ${wanted.size}, added ${added}, updated ${updated}, removed ${removed}`);
