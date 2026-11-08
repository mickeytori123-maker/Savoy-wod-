import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, onSnapshot, setDoc, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);

const EMBLEM = "emblem.png";
const TYPES = {
  time:   {label:"לזמן", better:"low"},
  rounds: {label:"AMRAP · סבבים + חזרות", better:"high"},
  reps:   {label:"חזרות", better:"high"},
  load:   {label:"משקל (ק״ג)", better:"high"},
  none:   {label:"ללא תוצאה", better:null}
};

const S = {uid:null,email:null,isCoach:false,ready:false,date:todayKey(),tab:"wod",
  wods:{},results:{},users:{},members:[],filter:{},draft:null,unsubs:[]};

/* ---------- helpers ---------- */
function todayKey(d=new Date()){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
function keyToDate(k){const [y,m,d]=k.split("-").map(Number);return new Date(y,m-1,d)}
function addDays(k,n){const d=keyToDate(k);d.setDate(d.getDate()+n);return todayKey(d)}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function heDate(k,opts={weekday:"long",day:"numeric",month:"long"}){return keyToDate(k).toLocaleDateString("he-IL",opts)}
function fmt(type,v){
  if(v==null||isNaN(v))return "—";
  if(type==="time"){const m=Math.floor(v/60),s=Math.round(v%60);return m+":"+String(s).padStart(2,"0")}
  if(type==="rounds"){const r=Math.floor(v/1000),x=Math.round(v%1000);return x?r+" + "+x:String(r)}
  if(type==="load")return (Math.round(v*10)/10)+" kg";
  return String(Math.round(v));
}
function toast(msg){const r=document.getElementById("toast-root");r.innerHTML='<div class="toast" role="status"></div>';r.firstChild.textContent=msg;clearTimeout(toast.t);toast.t=setTimeout(()=>r.innerHTML="",2200)}
function normName(s){return String(s||"").trim().toLowerCase().replace(/\s+/g," ")}
function initials(name){return (name||"?").trim().split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase()}
function avatarFor(uid){
  const u=S.users[uid]||{};
  if(u.photo)return u.photo;
  const c=["#ff6a13","#ffb21a","#f2431f","#7aa7ff","#4fd18b"][[...uid].reduce((a,ch)=>a+ch.charCodeAt(0),0)%5];
  return "data:image/svg+xml,"+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="${c}"/><text x="20" y="25" font-family="Arial" font-size="15" font-weight="700" text-anchor="middle" fill="#1a0d05">${esc(initials(u.name))}</text></svg>`);
}
function nameFor(uid){const n=S.users[uid]?.name||"מתאמן/ת";return uid===S.uid?n+" (אני)":n}
const ICON={
  wod:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/></svg>',
  me:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  coach:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4"/></svg>'
};

/* ---------- WOD text parser ---------- */
const HEAD_RE=/^\s*(?:(?:part|חלק)\s*([A-Za-zא-ת0-9]+)|([A-H])\s*[\.\):\-–]|(warm[\s-]?up|strength|skill|metcon|wod|conditioning|accessory|accessories|cool[\s-]?down|finisher|gymnastics|olympic|weightlifting|חימום|כוח|טכניקה|מטקון|סקיל|אביזרים|שחרור|מתיחות|אימון))(?=$|[\s:.\-–)])[\s:.\-–)]*(.*)$/i;
function guessType(name,text){
  const t=(name+" "+text).toLowerCase();
  if(/warm|cool|חימום|שחרור|מתיחות/.test(name.toLowerCase()))return "none";
  if(/for time|rft|לזמן|time cap|tc\s*\d/.test(t))return "time";
  if(/amrap/.test(t))return "rounds";
  if(/\b\d?rm\b|1rm|heavy|max load|build to|@\s*\d+\s*%|\d+\s*%|\d+\s*[x×]\s*\d+|\d+(-\d+){2,}|strength|כוח|weightlifting|olympic/.test(t))return "load";
  return "reps";
}
export function parseWod(text){
  const lines=String(text||"").replace(/\r/g,"").split("\n");
  const parts=[];let cur=null;const pre=[];
  for(const raw of lines){
    const line=raw.replace(/\s+$/,"");
    const m=line.match(HEAD_RE);
    if(m){
      const letter=(m[1]||m[2]||"").toUpperCase();const kw=m[3]||"";const rest=(m[4]||"").trim();
      const long=kw&&rest.length>40;
      cur={label:letter,name:(kw?kw.replace(/^\w/,c=>c.toUpperCase()):"")+(kw&&rest&&!long?" · ":"")+(rest&&!long?rest:""),body:long?[rest]:[]};
      if(!cur.name)cur.name="חלק "+(parts.length+1);
      parts.push(cur);
    }else if(cur)cur.body.push(line);
    else if(line.trim())pre.push(line.trim());
  }
  if(!parts.length)return {title:"",parts:pre.length?[{id:"a0",label:"A",name:"אימון",type:guessType("",pre.join("\n")),description:pre.join("\n")}]:[]};
  return {title:pre.join(" · "),parts:parts.map((p,i)=>{
    const desc=p.body.join("\n").replace(/^\n+|\n+$/g,"");const label=p.label||String.fromCharCode(65+i);
    return {id:label.toLowerCase()+i,label,name:p.name,type:guessType(p.name,desc),description:desc};
  })};
}

/* ---------- data ---------- */
function allEntries(){const out=[];for(const uid in S.results){const e=S.results[uid]||{};for(const k in e)out.push({uid,key:k,...e[k]})}return out}
function entriesFor(date,partId){return allEntries().filter(e=>e.wod===date&&e.part===partId)}
function rankEntries(list,type){
  const better=TYPES[type]?.better;
  return list.slice().sort((a,b)=>{if(!!b.rx!==!!a.rx)return b.rx?1:-1;return better==="low"?a.value-b.value:b.value-a.value});
}
let saving=false;
async function saveMine(next){
  if(saving)throw new Error("busy");saving=true;
  try{await setDoc(doc(db,"results",S.uid),{entries:next,updated:new Date().toISOString()})}finally{saving=false}
}

/* ---------- render ---------- */
function render(){
  if(S.tab==="coach")syncDraft();
  renderWho();renderTabs();
  const v=document.getElementById("view");
  v.innerHTML=S.tab==="me"?viewMe():S.tab==="coach"?viewCoach():viewWod();
}
function renderWho(){
  const el=document.getElementById("who");
  el.innerHTML='<span></span><img alt=""><button class="linkbtn" id="logout" type="button">יציאה</button>';
  el.querySelector("span").textContent=S.users[S.uid]?.name||"";
  el.querySelector("img").src=avatarFor(S.uid);
}
function renderTabs(){
  const tabs=[["wod","אימון"],["me","התוצאות שלי"]];if(S.isCoach)tabs.push(["coach","מאמן"]);
  document.getElementById("tabs").innerHTML=tabs.map(([k,l])=>`<button data-tab="${k}" class="${S.tab===k?"on":""}">${ICON[k]}<span>${l}</span></button>`).join("");
}
function weekStrip(){
  const sel=keyToDate(S.date);const start=addDays(S.date,-sel.getDay());const today=todayKey();let days="";
  for(let i=0;i<7;i++){const k=addDays(start,i);const d=keyToDate(k);
    days+=`<button class="day ${k===S.date?"sel":""} ${k===today?"today":""} ${S.wods[k]?"has":""}" data-date="${k}" aria-label="${esc(heDate(k))}"><span class="dn">${d.toLocaleDateString("he-IL",{weekday:"short"})}</span><span class="dd">${d.getDate()}</span><span class="dot"></span></button>`}
  return `<div class="week"><button class="arrow" data-week="-7" aria-label="שבוע קודם">›</button><div class="days">${days}</div><button class="arrow" data-week="7" aria-label="שבוע הבא">‹</button></div>`;
}
function viewWod(){
  const w=S.wods[S.date];const isToday=S.date===todayKey();
  let h=weekStrip()+`<div class="dateline"><h1>${isToday?"היום":esc(heDate(S.date,{weekday:"long"}))}</h1><span class="t">${esc(heDate(S.date,{day:"numeric",month:"long",year:"numeric"}))}</span></div>`;
  if(!S.ready)return h+`<div class="state"><img src="${EMBLEM}" alt=""><h3>טוען את האימון…</h3></div>`;
  if(!w||!w.parts?.length)return h+`<div class="state"><img src="${EMBLEM}" alt=""><h3>עוד לא עלה אימון ליום הזה</h3><div>${S.isCoach?'אפשר להעלות אותו בלשונית "מאמן".':"האימון יופיע כאן ברגע שהמאמן יעלה אותו."}</div>${S.isCoach?'<div style="margin-top:12px"><button class="btn primary" data-tab="coach">העלאת אימון</button></div>':""}</div>`;
  if(w.title)h+=`<p class="wodtitle">${esc(w.title)}</p>`;
  h+='<div class="parts">';
  for(const p of w.parts){
    const list=rankEntries(entriesFor(S.date,p.id),p.type);const f=S.filter[p.id]||"all";
    const shown=list.filter(e=>f==="all"||(f==="rx"?e.rx:!e.rx));const mine=list.find(e=>e.uid===S.uid);
    h+=`<section class="part"><div class="part-head"><span class="tag">${esc(p.label||"•")}</span><div><h2 dir="auto">${esc(p.name)}</h2><div class="ptype">${esc(TYPES[p.type]?.label||"")}</div></div></div>`;
    if(p.description)h+=`<div class="desc" dir="auto">${esc(p.description)}</div>`;
    if(p.type!=="none"){
      h+=`<div class="part-actions"><button class="btn ${mine?"":"primary"}" data-log="${esc(p.id)}">${mine?"עריכת התוצאה":"הזנת תוצאה"}</button>${mine?`<span class="mine-chip">שלי: <b dir="ltr">${esc(fmt(p.type,mine.value))}</b></span>`:""}</div>`;
      h+=`<div class="board"><div class="board-head"><span>לוח תוצאות · ${list.length}</span><div class="filters">${["all","rx","sc"].map(k=>`<button data-filter="${esc(p.id)}" data-f="${k}" class="${f===k?"on":""}">${k==="all"?"הכול":k==="rx"?"RX":"Scaled"}</button>`).join("")}</div></div>`;
      if(!shown.length)h+='<div class="empty">עוד אין תוצאות. תהיו הראשונים.</div>';
      shown.forEach((e,i)=>{h+=`<div class="row ${e.uid===S.uid?"me":""}"><span class="rank">${i+1}</span><img src="${avatarFor(e.uid)}" alt=""><div class="nm"><div class="n">${esc(nameFor(e.uid))}</div>${e.note?`<div class="note" dir="auto">${esc(e.note)}</div>`:""}</div><div class="score"><b>${esc(fmt(p.type,e.value))}</b><span class="badge ${e.rx?"rx":"sc"}">${e.rx?"RX":"SCALED"}</span></div></div>`});
      h+="</div>";
    }else h+='<div style="height:14px"></div>';
    h+="</section>";
  }
  return h+"</div>";
}
function viewMe(){
  const mine=Object.entries(S.results[S.uid]||{}).map(([k,e])=>({key:k,...e}));
  if(!mine.length)return `<div class="state"><img src="${EMBLEM}" alt=""><h3>עוד אין תוצאות</h3><div>הזינו תוצאה באימון של היום והיא תישמר כאן, יחד עם השיאים האישיים שלכם.</div></div>`;
  const prs={};for(const e of mine){if(e.type!=="load")continue;const k=normName(e.partName);if(!prs[k]||e.value>prs[k].value)prs[k]=e}
  const prList=Object.values(prs).sort((a,b)=>b.value-a.value);let h="";
  if(prList.length)h+='<div class="section-h">שיאים אישיים</div><div class="prs">'+prList.map(e=>`<div class="pr"><div class="k" dir="auto">${esc(e.partName)}</div><div class="v">${esc(fmt("load",e.value))}</div><div class="d">${esc(heDate(e.wod,{day:"numeric",month:"short",year:"2-digit"}))}</div></div>`).join("")+"</div>";
  mine.sort((a,b)=>a.wod<b.wod?1:a.wod>b.wod?-1:0);
  h+='<div class="section-h">היסטוריה</div><div class="hist">'+mine.map(e=>`<button class="hrow" style="background:none;border:0;border-top:1px solid #29242b;text-align:right;width:100%" data-goto="${esc(e.wod)}"><div><div class="p" dir="auto">${esc(e.partName)}</div><div class="d">${esc(heDate(e.wod,{weekday:"short",day:"numeric",month:"short"}))}${e.note?" · "+esc(e.note):""}</div></div><div class="score"><b>${esc(fmt(e.type,e.value))}</b><span class="badge ${e.rx?"rx":"sc"}">${e.rx?"RX":"SCALED"}</span></div></button>`).join("")+"</div>";
  return h;
}
function viewCoach(){
  if(!S.isCoach)return "";
  if(!S.draft){const ex=S.wods[S.date];S.draft={date:S.date,text:"",title:ex?.title||"",parts:ex?JSON.parse(JSON.stringify(ex.parts)):[],members:""}}
  const d=S.draft;
  let h=`<div class="section-h">העלאת אימון</div><div class="card">
    <label class="f">תאריך<input type="date" id="c-date" value="${esc(d.date)}"></label>
    <label class="f">הדבקת טקסט האימון<textarea id="c-text" placeholder="הדביקו כאן את האימון כמו שהוא מופיע ב-Arbox, לדוגמה:&#10;A. Back Squat&#10;5-5-3-3-1&#10;B. Metcon&#10;For time: 21-15-9 Thrusters, Pull-ups">${esc(d.text)}</textarea></label>
    <div class="hint">האפליקציה מזהה חלקים לפי שורות שמתחילות ב-A. / B. / Part A, או במילים כמו Warm-up, Strength, Metcon, חימום, כוח. אחרי הפירוק אפשר לתקן הכול.</div>
    <div class="rowbtns"><button class="btn primary" id="c-parse">פירוק לחלקים</button><button class="btn ghost" id="c-addpart">הוספת חלק ידנית</button></div></div>`;
  if(d.parts.length){
    h+=`<div class="section-h">תצוגה מקדימה · ${d.parts.length} חלקים</div><div class="card"><label class="f">כותרת היום (לא חובה)<input type="text" id="c-title" value="${esc(d.title)}" placeholder="למשל: Hero WOD"></label>`;
    d.parts.forEach((p,i)=>{h+=`<div class="pedit" data-i="${i}"><label class="f">אות<input type="text" data-k="label" value="${esc(p.label)}" maxlength="4"></label><label class="f">שם החלק<input type="text" data-k="name" value="${esc(p.name)}"></label><label class="f full">סוג תוצאה<select data-k="type">${Object.entries(TYPES).map(([k,t])=>`<option value="${k}" ${p.type===k?"selected":""}>${esc(t.label)}</option>`).join("")}</select></label><textarea data-k="description" placeholder="תיאור">${esc(p.description)}</textarea><div class="full"><button class="btn ghost danger" data-rmpart="${i}">הסרת החלק</button></div></div>`});
    h+=`<div class="rowbtns"><button class="btn primary" id="c-save">שמירה ופרסום למתאמנים</button>${S.wods[d.date]?'<button class="btn ghost danger" id="c-del">מחיקת האימון של היום הזה</button>':""}</div><div class="err" id="c-err"></div></div>`;
  }
  h+=`<div class="section-h">מתאמנים מורשים · ${S.members.length}</div><div class="card">
    <div class="hint">רק כתובות Gmail שברשימה יכולות להיכנס. בהמשך הרשימה תתעדכן אוטומטית מ-Arbox.</div>
    <label class="f">הוספת מתאמנים (כתובת אחת בכל שורה, או מופרדות בפסיקים)<textarea id="c-members" style="min-height:90px" dir="ltr" placeholder="dana@gmail.com&#10;yossi@gmail.com">${esc(d.members)}</textarea></label>
    <div class="rowbtns"><button class="btn primary" id="c-addmembers">הוספה</button></div>
    ${S.members.length?`<div class="mlist">${S.members.map(m=>`<div class="mrow"><span>${esc(m)}</span><button class="btn ghost danger" data-rmmember="${esc(m)}">הסרה</button></div>`).join("")}</div>`:""}</div>`;
  return h;
}

/* ---------- log sheet ---------- */
function openLog(partId){
  const w=S.wods[S.date];const p=w?.parts.find(x=>x.id===partId);if(!p)return;
  const key=S.date+"__"+p.id;const ex=(S.results[S.uid]||{})[key];const v=ex?.value;let inputs="";
  if(p.type==="time")inputs=`<div class="nums"><label class="f">דקות<input type="number" inputmode="numeric" min="0" id="l-a" value="${v!=null?Math.floor(v/60):""}"></label><span class="sep">:</span><label class="f">שניות<input type="number" inputmode="numeric" min="0" max="59" id="l-b" value="${v!=null?Math.round(v%60):""}"></label></div>`;
  else if(p.type==="rounds")inputs=`<div class="nums"><label class="f">סבבים<input type="number" inputmode="numeric" min="0" id="l-a" value="${v!=null?Math.floor(v/1000):""}"></label><span class="sep">+</span><label class="f">חזרות<input type="number" inputmode="numeric" min="0" id="l-b" value="${v!=null?Math.round(v%1000):""}"></label></div>`;
  else if(p.type==="load")inputs=`<div class="nums"><label class="f">משקל (ק״ג)<input type="number" inputmode="decimal" min="0" step="0.5" id="l-a" value="${v??""}"></label></div>`;
  else inputs=`<div class="nums"><label class="f">חזרות<input type="number" inputmode="numeric" min="0" id="l-a" value="${v??""}"></label></div>`;
  const rx=ex?!!ex.rx:true;
  document.getElementById("sheet-root").innerHTML=`<div class="scrim" id="scrim"><form class="sheet" id="logform" dir="rtl" role="dialog" aria-label="הזנת תוצאה">
    <h3 dir="auto">${esc(p.label?p.label+". ":"")}${esc(p.name)}</h3><div class="sub">${esc(TYPES[p.type].label)}</div>${inputs}
    <div class="seg" id="l-rx"><button type="button" class="rx ${rx?"on":""}" data-rx="1">RX</button><button type="button" class="sc ${rx?"":"on"}" data-rx="0">Scaled</button></div>
    <label class="f">הערה (לא חובה)<input type="text" id="l-note" maxlength="120" value="${esc(ex?.note||"")}" placeholder="למשל: 30 ק״ג, ring rows"></label>
    <div class="err" id="l-err"></div>
    <div class="rowbtns"><button class="btn primary" type="submit" style="flex:1">שמירה</button>${ex?'<button class="btn ghost danger" type="button" id="l-del">מחיקה</button>':""}<button class="btn ghost" type="button" id="l-cancel">ביטול</button></div></form></div>`;
  const form=document.getElementById("logform");let isRx=rx;const errEl=form.querySelector("#l-err");
  form.querySelector("#l-a")?.focus();
  form.querySelector("#l-rx").onclick=e=>{const b=e.target.closest("[data-rx]");if(!b)return;isRx=b.dataset.rx==="1";form.querySelectorAll("#l-rx button").forEach(x=>x.classList.toggle("on",x===b))};
  const close=()=>document.getElementById("sheet-root").innerHTML="";
  document.getElementById("scrim").onclick=e=>{if(e.target.id==="scrim")close()};
  form.querySelector("#l-cancel").onclick=close;
  const del=form.querySelector("#l-del");
  if(del)del.onclick=async()=>{const next={...(S.results[S.uid]||{})};delete next[key];try{await saveMine(next);close();toast("התוצאה נמחקה")}catch(err){errEl.textContent=errMsg(err)}};
  form.onsubmit=async e=>{e.preventDefault();
    const a=parseFloat(form.querySelector("#l-a")?.value);const bEl=form.querySelector("#l-b");const b=bEl?parseFloat(bEl.value||"0"):0;let value=null;
    if(p.type==="time"){if(b>59){errEl.textContent="שניות צריכות להיות בין 0 ל-59.";return}if(!isNaN(a)||b)value=(isNaN(a)?0:a)*60+(b||0)}
    else if(p.type==="rounds")value=isNaN(a)?null:a*1000+(b||0);
    else value=isNaN(a)?null:a;
    if(value==null||value<=0){errEl.textContent="צריך להזין תוצאה לפני השמירה.";return}
    const entry={wod:S.date,part:p.id,partName:p.name,type:p.type,value,rx:isRx,note:form.querySelector("#l-note").value.trim(),ts:new Date().toISOString()};
    const btn=form.querySelector("[type=submit]");btn.disabled=true;
    try{await saveMine({...(S.results[S.uid]||{}),[key]:entry});close();toast("התוצאה נשמרה")}catch(err){btn.disabled=false;errEl.textContent=errMsg(err)}
  };
}
function errMsg(err){
  if(err?.message==="busy")return "שמירה קודמת עדיין בתהליך. נסו שוב בעוד רגע.";
  if(err?.code==="permission-denied")return "אין לך הרשאה לשמור. בדקו שהמייל שלכם רשום אצל המאמן.";
  return "השמירה לא הצליחה. בדקו את החיבור ונסו שוב.";
}

/* ---------- events ---------- */
document.addEventListener("click",async e=>{
  const t=e.target.closest("button");if(!t)return;
  if(t.id==="logout"){await signOut(auth);return}
  if(t.dataset.tab){S.tab=t.dataset.tab;if(S.tab==="coach")S.draft=null;render();window.scrollTo(0,0);return}
  if(t.dataset.date){S.date=t.dataset.date;render();return}
  if(t.dataset.week){S.date=addDays(S.date,+t.dataset.week);render();return}
  if(t.dataset.goto){S.date=t.dataset.goto;S.tab="wod";render();window.scrollTo(0,0);return}
  if(t.dataset.filter){S.filter[t.dataset.filter]=t.dataset.f;render();return}
  if(t.dataset.log){openLog(t.dataset.log);return}
  if(S.tab==="coach")coachClick(t);
});
function syncDraft(){
  const d=S.draft;if(!d)return;
  const g=id=>document.getElementById(id);
  if(g("c-date"))d.date=g("c-date").value||d.date;
  if(g("c-text"))d.text=g("c-text").value;
  if(g("c-title"))d.title=g("c-title").value;
  if(g("c-members"))d.members=g("c-members").value;
  document.querySelectorAll(".pedit").forEach(el=>{const p=d.parts[+el.dataset.i];el.querySelectorAll("[data-k]").forEach(i=>p[i.dataset.k]=i.value)});
}
document.addEventListener("change",e=>{
  if(e.target.id==="c-date"){syncDraft();const ex=S.wods[S.draft.date];if(ex&&!S.draft.parts.length){S.draft.title=ex.title||"";S.draft.parts=JSON.parse(JSON.stringify(ex.parts))}render()}
});
async function coachClick(t){
  syncDraft();const d=S.draft;const err=()=>document.getElementById("c-err");
  if(t.id==="c-parse"){const r=parseWod(d.text);if(!r.parts.length){toast("לא נמצא טקסט לפירוק");return}d.parts=r.parts;if(r.title&&!d.title)d.title=r.title;render();toast(`זוהו ${r.parts.length} חלקים`);return}
  if(t.id==="c-addpart"){d.parts.push({id:"p"+Date.now().toString(36),label:String.fromCharCode(65+d.parts.length),name:"",type:"reps",description:""});render();return}
  if(t.dataset.rmpart!=null){d.parts.splice(+t.dataset.rmpart,1);render();return}
  if(t.id==="c-save"){
    if(d.parts.some(p=>!p.name.trim())){err().textContent="לכל חלק צריך שם.";return}
    const ids=new Set();d.parts.forEach((p,i)=>{if(!p.id||ids.has(p.id))p.id=(p.label||"p").toLowerCase()+i+Date.now().toString(36).slice(-3);ids.add(p.id)});
    t.disabled=true;
    try{await setDoc(doc(db,"wods",d.date),{date:d.date,title:d.title.trim(),parts:d.parts.map(p=>({id:p.id,label:p.label.trim(),name:p.name.trim(),type:p.type,description:p.description})),updated:new Date().toISOString()});
      S.date=d.date;S.tab="wod";S.draft=null;render();window.scrollTo(0,0);toast("האימון פורסם")}
    catch{t.disabled=false;err().textContent="הפרסום לא הצליח. בדקו את החיבור ונסו שוב."}
    return}
  if(t.id==="c-del"){
    if(t.dataset.confirm!=="1"){t.dataset.confirm="1";t.textContent="ללחוץ שוב כדי למחוק";return}
    try{await deleteDoc(doc(db,"wods",d.date));S.draft=null;render();toast("האימון נמחק")}catch{err().textContent="המחיקה לא הצליחה."}
    return}
  if(t.id==="c-addmembers"){
    const list=[...new Set(d.members.split(/[\s,;]+/).map(x=>x.trim().toLowerCase()).filter(x=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))];
    if(!list.length){toast("לא נמצאו כתובות מייל תקינות");return}
    t.disabled=true;
    for(const m of list)await setDoc(doc(db,"members",m),{added:new Date().toISOString(),source:"manual"});
    d.members="";render();toast(`נוספו ${list.length} מתאמנים`);return}
  if(t.dataset.rmmember){await deleteDoc(doc(db,"members",t.dataset.rmmember));toast("הוסר");return}
}

/* ---------- auth + boot ---------- */
const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:"select_account"});
const isStandalone=window.matchMedia("(display-mode: standalone)").matches||navigator.standalone;
document.getElementById("google-btn").onclick=async()=>{
  try{if(isStandalone)await signInWithRedirect(auth,provider);else await signInWithPopup(auth,provider)}
  catch(e){if(e?.code==="auth/popup-blocked"||e?.code==="auth/operation-not-supported-in-this-environment")await signInWithRedirect(auth,provider);
    else if(e?.code!=="auth/popup-closed-by-user")showLogin("הכניסה לא הצליחה. נסו שוב.")}
};
document.getElementById("switch-btn").onclick=()=>signOut(auth);
getRedirectResult(auth).catch(()=>{});

function showLogin(msg,canSwitch=false){
  document.getElementById("app").hidden=true;document.getElementById("login").hidden=false;
  if(msg)document.getElementById("login-msg").textContent=msg;
  document.getElementById("switch-btn").hidden=!canSwitch;document.getElementById("google-btn").hidden=canSwitch;
}
function stopListeners(){S.unsubs.forEach(u=>u());S.unsubs=[]}

onAuthStateChanged(auth,async user=>{
  stopListeners();
  if(!user){Object.assign(S,{uid:null,email:null,isCoach:false,ready:false,wods:{},results:{},users:{},members:[]});showLogin("אפליקציית התוצאות של CrossFit Savoy. נכנסים עם חשבון Google שרשום ב-Arbox.");return}
  S.uid=user.uid;S.email=(user.email||"").toLowerCase();
  let coach=false,member=false;
  try{coach=(await getDoc(doc(db,"coaches",S.email))).exists()}catch{}
  if(!coach){try{member=(await getDoc(doc(db,"members",S.email))).exists()}catch{}}
  if(!coach&&!member){showLogin(`החשבון ${S.email} עוד לא רשום כמתאמן ב-Savoy. בקשו מהמאמן להוסיף אותו, או היכנסו עם המייל שרשום אצלנו.`,true);return}
  S.isCoach=coach;
  await setDoc(doc(db,"users",S.uid),{name:user.displayName||S.email.split("@")[0],photo:user.photoURL||"",lastSeen:new Date().toISOString()},{merge:true}).catch(()=>{});
  document.getElementById("login").hidden=true;document.getElementById("app").hidden=false;
  render();
  let gotW=false,gotR=false;const done=()=>{if(gotW&&gotR&&!S.ready){S.ready=true}};
  S.unsubs.push(onSnapshot(collection(db,"wods"),snap=>{const w={};snap.forEach(d=>{const x=d.data();if(Array.isArray(x.parts))w[d.id]=x});S.wods=w;gotW=true;done();if(S.tab!=="coach")render();else renderTabs()}));
  S.unsubs.push(onSnapshot(collection(db,"results"),snap=>{const r={};snap.forEach(d=>{const x=d.data();if(x.entries)r[d.id]=x.entries});S.results=r;gotR=true;done();if(S.tab!=="coach")render()}));
  S.unsubs.push(onSnapshot(collection(db,"users"),snap=>{const u={};snap.forEach(d=>u[d.id]=d.data());S.users=u;if(S.tab!=="coach")render();else renderWho()}));
  if(coach)S.unsubs.push(onSnapshot(collection(db,"members"),snap=>{S.members=snap.docs.map(d=>d.id).sort();if(S.tab==="coach")render()}));
});
