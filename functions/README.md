# בוט וואטסאפ — CrossFit Savoy

מתאמן כותב לוואטסאפ של העסק → הבוט מזהה אותו לפי מספר הטלפון ב-Arbox → מבין מה הוא רוצה → עונה בשמו ומציע כפתורי בחירה.

## מה הבוט יודע לעשות
| המתאמן כותב | הבוט |
|---|---|
| "מה יש מחר בבוקר?" | מציג את השיעורים מ-Arbox ככפתורים, ובלחיצה שולח לינק הרשמה לשיעור |
| "מתי נגמר לי המנוי?" | בודק ב-Arbox את המנוי של **אותו מתאמן בלבד** |
| "כמה עולה מנוי?" | מציג מנויים/כרטיסיות עם מחיר ולינק רכישה |
| "מה האימון היום?" | קורא את האימון שפורסם באפליקציית Savoy WOD |
| "אני רוצה להקפיא / לדבר עם מישהו" | מעביר לצוות (הודעה למספרי הצוות), ושותק מול המתאמן כמה שעות |
| מספר לא מוכר | מתייחס אליו כליד: מסביר על המכון, מציע אימון ניסיון, ומעדכן את הצוות |

**מגבלה כרגע:** ה-API של Arbox שזמין לנו לא כולל הרשמה או ביטול ישירים, ולכן הבוט שולח לינק הרשמה לשיעור. אם Arbox יספקו endpoint להרשמה, מוסיפים כלי אחד ב-`src/agent.js`.

## מבנה
- `index.js` — ה-webhook (Firebase Function `whatsappWebhook`)
- `src/agent.js` — ההנחיות לבוט והכלים שלו
- `src/arbox.js` — קריאות ל-Arbox
- `src/whatsapp.js` — קבלה ושליחה של הודעות וואטסאפ, כולל כפתורים ורשימות
- `gym-info.md` — **מידע על המכון שהבוט עונה לפיו. ערכו אותו!** (שורות עם TODO לא מגיעות לבוט)
- `test/` — בדיקות (`npm test`)
- `scripts/chat.js` — שיחה עם הבוט בטרמינל, על נתוני Arbox אמיתיים

## הקמה

### 1. חשבון WhatsApp Business API (בערך חצי שעה, פעם אחת)
1. נכנסים ל-[business.facebook.com](https://business.facebook.com) ופותחים חשבון עסקי (Business Portfolio), אם עוד אין.
2. נכנסים ל-[developers.facebook.com/apps](https://developers.facebook.com/apps) → **Create App** → סוג **Business** → מוסיפים את המוצר **WhatsApp**.
3. ב-**WhatsApp → API Setup** מוסיפים את מספר הטלפון של העסק ומאמתים אותו ב-SMS.
   - אם המספר כבר פעיל באפליקציית WhatsApp Business, Meta מציעים "coexistence", שמאפשר להמשיך להשתמש באפליקציה באותו מספר. אחרת, אפשר להשתמש במספר חדש לבוט.
4. רושמים את **Phone number ID**.
5. יוצרים **טוקן קבוע**: Business Settings → Users → **System users** → Add → Generate token, עם ההרשאות `whatsapp_business_messaging` ו-`whatsapp_business_management`.
6. רושמים את **App Secret** מ-App settings → Basic.
7. מוסיפים אמצעי תשלום ב-WhatsApp Manager. שיחות שהלקוח פותח (שירות) חינמיות ברובן.

### 2. מפתחות
- **Anthropic API key**: מ-[platform.claude.com](https://platform.claude.com) → API keys.
- **Arbox API key**: מנהל המערכת ב-Arbox (הגדרות → API), או דרך התמיכה של Arbox.

### 3. העלאה ל-Firebase
צריך את תוכנית **Blaze** (תשלום לפי שימוש) כדי להריץ Functions. בעסק בגודל של מכון העלות בדרך כלל זניחה.
```bash
cd functions && npm install
firebase functions:secrets:set ANTHROPIC_API_KEY
firebase functions:secrets:set ARBOX_API_KEY
firebase functions:secrets:set WHATSAPP_TOKEN
firebase functions:secrets:set WHATSAPP_APP_SECRET
firebase functions:secrets:set WHATSAPP_VERIFY_TOKEN   # מחרוזת אקראית שאתם ממציאים
firebase deploy --only functions
```
בהעלאה הראשונה Firebase שואל על הערכים הבאים, והם נשמרים בקובץ `functions/.env.savoy-wod`:
- `WHATSAPP_PHONE_NUMBER_ID`: מסעיף 1
- `STAFF_PHONES`: מספרי הצוות שמקבלים התראות, בפורמט `972521234567`, מופרדים בפסיקים
- `HANDOFF_HOURS`: כמה שעות הבוט שותק אחרי העברה לצוות (ברירת מחדל: 4)

### 4. חיבור ה-webhook
ב-Meta: WhatsApp → **Configuration** → Webhook:
- **Callback URL**: הכתובת שהדפיס `firebase deploy` (נגמרת ב-`whatsappWebhook`)
- **Verify token**: אותה מחרוזת של `WHATSAPP_VERIFY_TOKEN`
- **Webhook fields**: מסמנים `messages`

זהו. שלחו הודעה למספר ובדקו שהבוט עונה.

## הגדרות אופציונליות (משתני סביבה)
| משתנה | ברירת מחדל | |
|---|---|---|
| `BOT_MODEL` | `claude-opus-5-5` | מודל Claude |
| `BOT_EFFORT` | `low` | עומק החשיבה (`low`/`medium`/`high`). אם התשובות שטחיות, מעלים ל-`medium` |
| `BOT_HIDDEN_PLANS` | `צוות` | שמות מנויים שהבוט לא יציע ללקוחות, מופרדים בפסיקים |
| `ARBOX_API_KEY_HEADER` | `apiKey` | שם ה-header של המפתח ב-Arbox |

## הערות
- **התראות לצוות:** וואטסאפ מאפשר לשלוח הודעה חופשית רק למי שכתב למספר של הבוט ב-24 השעות האחרונות. כדי שההתראות יגיעו בכל זמן, כל איש צוות צריך לשלוח לבוט הודעה מדי פעם, או שמגדירים תבנית הודעה (template) מאושרת. בכל מקרה, כל העברה לצוות נשמרת גם ב-Firestore באוסף `botHandoffs`.
- **שיחות** נשמרות ב-Firestore באוסף `botConversations`, ואינן נגישות מהאפליקציה (חוקי האבטחה חוסמים). שיחה חדשה מתחילה אחרי 6 שעות של שקט.
- מומלץ להגדיר TTL ב-Firestore על האוסף `botProcessed` (השדה `at`), כדי למחוק רשומות ישנות.
- הבוט רואה מידע אישי רק של מי ששלח את ההודעה, לפי מספר הוואטסאפ שלו. אין כלי שמאפשר לשאול על מתאמן אחר.

## בדיקה מקומית
```bash
cd functions
npm test                                              # בדיקות, בלי רשת
ARBOX_API_KEY=... node scripts/try-arbox.js 0521234567  # בדיקת חיבור ל-Arbox
ANTHROPIC_API_KEY=... ARBOX_API_KEY=... node scripts/chat.js 0521234567  # שיחה עם הבוט
```
