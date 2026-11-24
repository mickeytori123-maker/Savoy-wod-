#!/usr/bin/env bash
# One-time setup of the Savoy WhatsApp bot: asks for the keys, stores them as
# Firebase secrets, deploys, and connects 360dialog to the bot.
# Run from the repo:  bash functions/setup.sh
set -euo pipefail
cd "$(dirname "$0")"

PROJECT="savoy-wod"
REGION="europe-west1"
FB="npx --yes firebase-tools@latest"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ask_secret() { # name, prompt
  local v
  read -r -s -p "$2: " v; echo
  [ -n "$v" ] || { echo "חובה למלא."; exit 1; }
  printf '%s' "$v" | $FB functions:secrets:set "$1" --project "$PROJECT" --data-file - >/dev/null
  printf '%s' "$v"
}

say "1/5  התחברות ל-Firebase (ייפתח דפדפן אם צריך)"
$FB login
npm install --no-audit --no-fund --silent

say "2/5  מפתחות (ההקלדה מוסתרת, וכל מפתח נשמר רק ב-Firebase Secrets)"
ask_secret ANTHROPIC_API_KEY "מפתח Claude (platform.claude.com → API keys)" >/dev/null
ask_secret ARBOX_API_KEY "מפתח Arbox (Arbox → הגדרות → API)" >/dev/null
D360_KEY=$(ask_secret WHATSAPP_TOKEN "מפתח 360dialog (360dialog Hub → API key)")
WEBHOOK_TOKEN=$(openssl rand -hex 16)
printf '%s' "$WEBHOOK_TOKEN" | $FB functions:secrets:set WEBHOOK_TOKEN --project "$PROJECT" --data-file - >/dev/null
echo "נשמר. נוצר גם קוד אבטחה ל-webhook."

say "3/5  מספרי הצוות שיקבלו התראות"
read -r -p "מספרים בפורמט 972521234567, מופרדים בפסיקים: " STAFF
cat > ".env.$PROJECT" <<EOF
WHATSAPP_PROVIDER=360dialog
WHATSAPP_PHONE_NUMBER_ID=
STAFF_PHONES=$STAFF
HANDOFF_HOURS=4
EOF

say "4/5  העלאה ל-Firebase (כמה דקות)"
$FB deploy --only functions --project "$PROJECT" --force

say "5/5  חיבור 360dialog לבוט"
URL="https://$REGION-$PROJECT.cloudfunctions.net/whatsappWebhook?token=$WEBHOOK_TOKEN"
D360_API_KEY="$D360_KEY" node scripts/set-360dialog-webhook.js "$URL"

say "✅ מוכן! שלחו הודעה מטלפון אחר למספר של העסק."
