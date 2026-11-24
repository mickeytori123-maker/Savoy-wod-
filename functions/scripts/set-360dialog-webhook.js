// Point your 360dialog number at the bot (run once after `firebase deploy`).
//   D360_API_KEY=... node scripts/set-360dialog-webhook.js "https://...cloudfunctions.net/whatsappWebhook?token=<WEBHOOK_TOKEN>"
const [url] = process.argv.slice(2);
const key = process.env.D360_API_KEY;
if (!url || !key) {
  console.error('Usage: D360_API_KEY=... node scripts/set-360dialog-webhook.js "<function URL>?token=<WEBHOOK_TOKEN>"');
  process.exit(1);
}
if (!new URL(url).searchParams.get("token")) {
  console.error("The URL must include ?token=<WEBHOOK_TOKEN>, otherwise the bot rejects every message.");
  process.exit(1);
}
const base = process.env.WHATSAPP_BASE_URL || "https://waba-v2.360dialog.io";
const res = await fetch(`${base}/v1/configs/webhook`, {
  method: "POST",
  headers: { "D360-API-KEY": key, "Content-Type": "application/json" },
  body: JSON.stringify({ url }),
});
console.log(res.status, await res.text());
