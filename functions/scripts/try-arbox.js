// Quick check that the Arbox connection works (read-only).
//   ARBOX_API_KEY=... node scripts/try-arbox.js [phone]
import { createArbox, pickBestUser, simplifyClass } from "../src/arbox.js";
import { isoDate } from "../src/agent.js";

const arbox = createArbox();
const today = isoDate();
const classes = await arbox.getSchedule(today, today);
console.log(`שיעורים היום (${today}): ${classes.length}`);
for (const c of classes.map(simplifyClass)) console.log(`  ${c.start}-${c.end} ${c.name} · ${c.coach ?? ""}`);

const types = await arbox.getMembershipTypes();
console.log(`סוגי מנויים: ${types.length}`);

if (process.argv[2]) {
  const u = pickBestUser(await arbox.findUsersByPhone(process.argv[2]));
  console.log(u ? `טלפון מזוהה: ${u.first_name} (${u.user_role})` : "טלפון לא נמצא");
  if (u) console.log(`מנויים: ${(await arbox.getUserMemberships(u.user_id)).length}`);
}
