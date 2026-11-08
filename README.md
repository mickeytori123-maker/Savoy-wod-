# Savoy WOD

אפליקציית תוצאות ל-CrossFit Savoy: אימון יומי לפי חלקים, הזנת תוצאות, לוח תוצאות משותף ושיאים אישיים.
כניסה עם Google, ורק מתאמנים רשומים יכולים להיכנס.

## מבנה
- `public/` – האפליקציה (HTML/CSS/JS, בלי שלב build)
- `firestore.rules` – הרשאות: מתאמנים רואים הכול וכותבים רק את התוצאות שלהם, מאמנים מפרסמים אימונים ומנהלים את רשימת המתאמנים
- `firebase.json` – הגדרות Firebase Hosting

## הקמה (פעם אחת)
1. ב-Firebase Console: Build → Authentication → Sign-in method → להפעיל Google.
2. Build → Firestore Database → Create database.
3. Project settings → Your apps → Web app → להעתיק את הערכים ל-`public/firebase-config.js`.
4. Firestore → ליצור אוסף `coaches` ובו מסמך שה-ID שלו הוא המייל של המאמן (באותיות קטנות).
5. `firebase deploy`

## נתונים
- `wods/{YYYY-MM-DD}` – אימון היום: `title`, `parts[] {id,label,name,type,description}`
- `results/{uid}` – `entries{ "<date>__<partId>": {value, rx, note, ...} }`
- `users/{uid}` – שם ותמונה
- `members/{email}` – מתאמנים מורשים
- `coaches/{email}` – מאמנים
