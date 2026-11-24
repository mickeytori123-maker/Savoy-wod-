// Talk to the bot in the terminal, as if from WhatsApp. Uses real Arbox data and
// the real Claude API; WhatsApp sending is printed instead.
//   ANTHROPIC_API_KEY=... ARBOX_API_KEY=... node scripts/chat.js 0521234567
import readline from "node:readline/promises";
import { readFileSync } from "node:fs";
import { createArbox, pickBestUser } from "../src/arbox.js";
import { buildSystemPrompt, handleMessage } from "../src/agent.js";

const phone = process.argv[2] || "";
const arbox = createArbox();
const gymInfo = readFileSync(new URL("../gym-info.md", import.meta.url), "utf8")
  .replace(/<!--[\s\S]*?-->/g, "").split("\n").filter((l) => !l.includes("TODO")).join("\n");

const u = phone ? pickBestUser(await arbox.findUsersByPhone(phone)) : null;
const member = { arbox: u ? { userId: u.user_id, firstName: u.first_name, lastName: u.last_name || "", role: u.user_role } : null, whatsappName: null };
console.log(u ? `מזוהה: ${u.first_name} (${u.user_role})` : "מספר לא מזוהה (ליד)");

const state = { messages: [], pending: [] };
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let lastOptions = [];
for (;;) {
  let text = (await rl.question("\nאתה: ")).trim();
  if (!text) continue;
  const n = Number(text);
  if (n >= 1 && n <= lastOptions.length) {
    const o = lastOptions[n - 1];
    text = `[בחר באפשרות: "${o.title}" | id=${o.id}]`;
  }
  await handleMessage(state, text, {
    arbox, member,
    system: buildSystemPrompt(gymInfo),
    getWorkout: async () => null,
    notifyStaff: async (s) => console.log(`  🔔 (לצוות) ${s}`),
    send: async ({ text, options = [] }) => {
      console.log(`\nבוט: ${text}`);
      options.forEach((o, i) => console.log(`  [${i + 1}] ${o.title}${o.description ? " — " + o.description : ""}`));
      lastOptions = options;
    },
  });
}
