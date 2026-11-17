import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, setDoc, deleteDoc, getDoc, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { splitWeek,CATS,WEIGHT_CATS,LIFTS,OLY,RM_REPS,detectLift,rmOf,guessCategory,guessType,enrichPart,parseWod } from "./parser.js";

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
// Keep a copy of the data on the phone so the app opens instantly from cache and then syncs.
let db;
try{db=initializeFirestore(fb,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})})}catch(e){db=getFirestore(fb)}

const EMBLEM = "emblem.png";
const TYPES = {
  time:   {label:"זמן (For time)", better:"low"},
  reps:   {label:"חזרות (AMRAP / Max reps)", better:"high"},
  load:   {label:"משקל (ק״ג)", better:"high"},
  none:   {label:"ללא תוצאה", better:null},
  rounds: {label:"סבבים + חזרות", better:"high"}
};
function usesRx(p){return p?(p.category?p.category==="Metcon":p.type!=="load"):true}
function entryUsesRx(e){const p=partOf(e);return p?usesRx(p):(e.cat?e.cat==="Metcon":e.type!=="load")}
function isWeightPart(p){return p&&(WEIGHT_CATS.has(p.category)||(!p.category&&p.type==="load"))}
const round05=v=>Math.round(v*2)/2;
const LIFT_GROUPS=[["כוח",["Back Squat","Front Squat","Overhead Squat","Deadlift","Sumo Deadlift","Romanian Deadlift","Bench Press","Strict Press","Push Press","Thruster","Weighted Pull-up"]],["הרמת משקולות",["Clean & Jerk","Clean","Squat Clean","Power Clean","Hang Clean","Hang Power Clean","Snatch","Squat Snatch","Power Snatch","Hang Snatch","Hang Power Snatch","Jerk","Push Jerk","Split Jerk"]]];
function liftOptions(selected,extra=[]){
  const known=new Set(LIFT_GROUPS.flatMap(g=>g[1]));const custom=[...new Set(extra.filter(l=>l&&!known.has(l)))];
  if(selected&&!known.has(selected)&&!custom.includes(selected))custom.push(selected);
  let h=`<option value="" ${selected?"":"selected"} disabled>בחרו תרגיל</option>`;
  for(const [g,ls] of LIFT_GROUPS)h+=`<optgroup label="${esc(g)}">`+ls.map(l=>`<option value="${esc(l)}" ${l===selected?"selected":""}>${esc(l)}</option>`).join("")+"</optgroup>";
  if(custom.length)h+=`<optgroup label="התרגילים שלי">`+custom.map(l=>`<option value="${esc(l)}" ${l===selected?"selected":""}>${esc(l)}</option>`).join("")+"</optgroup>";
  return h+`<option value="__other">אחר…</option>`;
}

const S = {uid:null,email:null,isCoach:false,ready:false,date:todayKey(),tab:"wod",gender:"all",mode:"parts",
  wods:{},results:{},rms:{},users:{},members:[],filter:{},draft:null,unsubs:[],likesDay:{},likesDate:null,likesUnsub:null,likesMine:[],importStatus:null,week:null};

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
  timer:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6M12 2v3"/></svg>',
  coach:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4"/></svg>'
};

/* ---------- WOD text parser ---------- */
/* ---------- data ---------- */
function allEntries(){const out=[];for(const uid in S.results){const e=S.results[uid]||{};for(const k in e)out.push({uid,key:k,...e[k]})}return out}
function entriesFor(date,partId){return allEntries().filter(e=>e.wod===date&&e.part===partId)}
function rankEntries(list,type,rx=true){
  const better=TYPES[type]?.better;
  return list.slice().sort((a,b)=>{if(rx&&!!b.rx!==!!a.rx)return b.rx?1:-1;return better==="low"?a.value-b.value:b.value-a.value});
}
let saving=false;
async function saveMine(nextEntries,nextRms){
  if(saving)throw new Error("busy");saving=true;
  try{await setDoc(doc(db,"results",S.uid),{entries:nextEntries??(S.results[S.uid]||{}),rms:nextRms??(S.rms[S.uid]||{}),updated:new Date().toISOString()})}finally{saving=false}
}
function partOf(e){return S.wods[e.wod]?.parts?.find(p=>p.id===e.part)}
function liftOfEntry(e){const p=partOf(e);return e.lift||p?.lift||detectLift((p?.name||e.partName||"")+"\n"+(p?.description||""))||e.partName}
function isWeightEntry(e){if(e.type!=="load")return false;const p=partOf(e);if(p)return isWeightPart(p);return e.cat?WEIGHT_CATS.has(e.cat):true}
// all rep-max records of a user: manual entries + results logged on "nRM" parts
function rmRecords(uid){
  const out=[];const rms=S.rms[uid]||{};for(const id in rms)out.push({...rms[id],id,src:"manual"});
  const en=S.results[uid]||{};for(const k in en){const e=en[k];const p=partOf(e);const n=e.rm||(p?rmOf(p):0);if(n&&e.type==="load")out.push({lift:liftOfEntry(e),reps:n,value:e.value,date:e.wod,src:"log",key:k})}
  return out.filter(r=>r.lift&&r.value>0);
}
function bestRM(uid,lift,reps){let b=null;for(const r of rmRecords(uid))if(normName(r.lift)===normName(lift)&&r.reps===reps&&(!b||r.value>b.value))b=r;return b}
function oneRM(uid,lift){
  const one=bestRM(uid,lift,1);if(one)return {value:one.value,est:false};
  let best=null;for(const r of rmRecords(uid))if(normName(r.lift)===normName(lift)&&r.reps>1){const v=r.value*(1+r.reps/30);if(!best||v>best.value)best={value:v,est:true,from:r.reps}}
  return best;
}
function bestWorking(uid,lift,exceptKey){let b=null;const en=S.results[uid]||{};for(const k in en){if(k===exceptKey)continue;const e={...en[k]};if(!isWeightEntry(e))continue;if(normName(liftOfEntry(e))!==normName(lift))continue;if(!b||e.value>b.value)b={...e,key:k}}return b}

/* ---------- render ---------- */
/* ---------- likes ---------- */
const likeId=(owner,wod,part,by)=>[owner,wod,part,by].join("__");
function likesFor(owner,part){return Object.values(S.likesDay).filter(l=>l.owner===owner&&l.part===part&&l.wod===S.date)}
function likeBtn(owner,part){
  const ls=likesFor(owner,part);const mine=ls.some(l=>l.by===S.uid);const own=owner===S.uid;
  const heart=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 5 6.4 5c2 0 3.3 1.1 4 2.2h3.2C14.3 6.1 15.6 5 17.6 5 21 5 23.1 8.4 21.6 11.8 19.5 16.4 12 21 12 21z"/></svg>`;
  if(own)return `<span class="like own ${ls.length?"has":""}" title="לייקים לתוצאה שלך">${heart}<i>${ls.length||""}</i></span>`;
  return `<button class="like ${mine?"on":""}" data-like="${esc(owner)}" data-lpart="${esc(part)}" aria-pressed="${mine}" aria-label="${mine?"ביטול לייק":"לייק"}">${heart}<i>${ls.length||""}</i></button>`;
}
function subDayLikes(){
  if(S.likesDate===S.date||!S.uid)return;S.likesDate=S.date;if(S.likesUnsub)S.likesUnsub();S.likesDay={};
  const d=S.date;S.likesUnsub=onSnapshot(query(collection(db,"likes"),where("wod","==",d)),snap=>{if(S.likesDate!==d)return;const m={};snap.forEach(x=>m[x.id]=x.data());S.likesDay=m;if(S.tab==="wod")render()},err=>{console.error("likes listener",err);toast("לא הצלחנו לטעון לייקים ("+(err?.code||"error")+")")});
}
async function toggleLike(owner,part){
  const id=likeId(owner,S.date,part,S.uid);const ref=doc(db,"likes",id);const had=S.likesDay[id];
  const data={owner,wod:S.date,part,by:S.uid,ts:new Date().toISOString()};
  // optimistic: show the change right away, roll back if the server refuses
  if(had)delete S.likesDay[id];else S.likesDay[id]=data;render();
  try{if(had)await deleteDoc(ref);else await setDoc(ref,data)}
  catch(err){console.error("like failed",err);if(had)S.likesDay[id]=had;else delete S.likesDay[id];render();toast("הלייק לא נשמר ("+(err?.code||"error")+"). נסו שוב.")}
}
function unseenLikes(){const seen=S.users[S.uid]?.likesSeen||"";return S.likesMine.filter(l=>l.by!==S.uid&&l.ts>seen)}
function partLabel(wod,part){const p=S.wods[wod]?.parts?.find(x=>x.id===part);return p?(p.lift||p.name):"האימון"}
function likeText(l){const e=(S.results[S.uid]||{})[l.wod+"__"+l.part];return `${S.users[l.by]?.name||"מתאמן/ת"} נתן/ה לייק לתוצאה שלך ב-${partLabel(l.wod,l.part)}${e?" · "+fmt(e.type,e.value):""}`}
/* ---------- sound ---------- */
let AC=null;
function soundOn(){try{return localStorage.getItem("savoySound")!=="off"}catch{return true}}
function unlockAudio(){try{AC=AC||new (window.AudioContext||window.webkitAudioContext)();if(AC.state==="suspended")AC.resume()}catch{AC=null}}
// One bell-like note: a few partials (incl. the inharmonic 2.76x "bell" partial) with a fast attack and natural decay.
function bell(ac,out,f,st,len,amp=1){
  [[1,"sine",0.6],[2,"sine",0.18],[2.76,"sine",0.1],[4.07,"sine",0.04]].forEach(([h,type,a])=>{const o=ac.createOscillator(),g=ac.createGain();o.type=type;o.frequency.value=f*h;
    const l=len/(h>2?1.8:1);g.gain.setValueAtTime(0.0001,st);g.gain.exponentialRampToValueAtTime(a*amp,st+0.006);g.gain.exponentialRampToValueAtTime(0.0001,st+l);o.connect(g);g.connect(out);o.start(st);o.stop(st+l+0.05)});
}
// Soft low "thump" that gives the save a physical, landed feel.
function thump(ac,out,st,amp=0.5){const o=ac.createOscillator(),g=ac.createGain();o.type="sine";o.frequency.setValueAtTime(170,st);o.frequency.exponentialRampToValueAtTime(55,st+0.16);
  g.gain.setValueAtTime(0.0001,st);g.gain.exponentialRampToValueAtTime(amp,st+0.008);g.gain.exponentialRampToValueAtTime(0.0001,st+0.2);o.connect(g);g.connect(out);o.start(st);o.stop(st+0.25)}
function beepTone(ac,out,f,st,len,amp=0.5){const o=ac.createOscillator(),g=ac.createGain();o.type="square";o.frequency.value=f;
  g.gain.setValueAtTime(0.0001,st);g.gain.exponentialRampToValueAtTime(amp,st+0.005);g.gain.setValueAtTime(amp,st+len-0.03);g.gain.exponentialRampToValueAtTime(0.0001,st+len);o.connect(g);g.connect(out);o.start(st);o.stop(st+len+0.02)}
// kinds: save (result saved), pr (personal record), beep / go / end (timer). All respect the sound switch in settings.
function chime(kind="save"){
  if(!soundOn())return;unlockAudio();const ac=AC;if(!ac)return;
  const t0=ac.currentTime+0.03;const master=ac.createGain();master.connect(ac.destination);
  if(kind==="save"){
    // "ka-ching": thump + two quick rising bell notes (B5 → E6), the second one ringing out
    master.gain.value=0.32;thump(ac,master,t0,0.55);bell(ac,master,987.77,t0+0.01,0.35,0.8);bell(ac,master,1318.51,t0+0.1,0.9,1);
    try{navigator.vibrate&&navigator.vibrate([18,40,28])}catch{}
  }else if(kind==="pr"){
    // fanfare: thump, rising major arpeggio, and a sparkle on top
    master.gain.value=0.26;thump(ac,master,t0,0.6);
    [523.25,659.25,783.99,1046.5,1318.51].forEach((f,i)=>bell(ac,master,f,t0+i*0.085,i===4?1.4:0.5,0.9));
    [2093,2637,3136,2637,3136].forEach((f,i)=>bell(ac,master,f,t0+0.45+i*0.06,0.3,0.25));
    try{navigator.vibrate&&navigator.vibrate([30,50,30,50,120])}catch{}
  }else if(kind==="beep"){master.gain.value=0.22;beepTone(ac,master,880,t0,0.16)}
  else if(kind==="go"){master.gain.value=0.25;beepTone(ac,master,1320,t0,0.55);try{navigator.vibrate&&navigator.vibrate(200)}catch{}}
  else if(kind==="end"){master.gain.value=0.25;[0,0.28,0.56].forEach(d=>beepTone(ac,master,1320,t0+d,0.22));try{navigator.vibrate&&navigator.vibrate([200,80,200,80,400])}catch{}}
}
/* ---------- class booking: the box's branded Arbox app ("X-Group") ---------- */
const BOOK_IOS="https://apps.apple.com/il/app/x-group/id1612661434";
const BOOK_ANDROID="https://play.google.com/store/search?q=X-Group%20Arbox&c=apps";
function bookingHTML(){const url=isIOS?BOOK_IOS:BOOK_ANDROID;
  return `<a class="booking" href="${url}" target="_blank" rel="noopener"><span class="bk-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4"/></svg></span><span><b>הרשמה לשיעור</b><small>פותח את אפליקציית X-Group</small></span><span class="bk-go"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg></span></a>`}

/* ---------- theme ---------- */
function isDark(){return document.documentElement.dataset.theme==="dark"}
function toggleTheme(){const dark=!isDark();if(dark)document.documentElement.dataset.theme="dark";else delete document.documentElement.dataset.theme;try{localStorage.setItem("savoyTheme",dark?"dark":"light")}catch{}}

/* ---------- benchmark PRs (named metcons like "Fran", repeated over time) ---------- */
const GENERIC_NAME=/^(metcon|wod|amrap|emom|e\d+mom|for ?time|rft|conditioning|finisher|accessor(y|ies)|skill|gymnastics|strength|weightlifting|warm[ -]?up|cool[ -]?down|tabata|intervals?|chipper|partner wod|team wod|אימון|מטקון|כוח|חימום|סקיל|אביזרים|חלק \d+|part [a-z0-9]+)$/i;
function benchKey(e){if(!["time","reps","rounds"].includes(e.type))return "";const n=normName(curName(e));if(n.length<3||GENERIC_NAME.test(n)||CATS.some(c=>normName(c)===n))return "";return e.type+"|"+n}
function isBenchBest(e){const k=benchKey(e);if(!k)return false;const en=S.results[S.uid]||{};let n=0;for(const key in en){const x=en[key];if(key===e.key||benchKey(x)!==k||!!x.rx!==!!e.rx)continue;n++;if(!better(e.type,e.value,x.value))return false}return n>0}
function better(type,a,b){return TYPES[type]?.better==="low"?a<b:a>b}
function prevBench(uid,e,exceptKey){const k=benchKey(e);if(!k)return null;let b=null;const en=S.results[uid]||{};
  for(const key in en){if(key===exceptKey)continue;const x={...en[key],key};if(x.wod>e.wod)continue;if(benchKey(x)!==k||!!x.rx!==!!e.rx)continue;if(!b||better(e.type,x.value,b.value))b=x}
  return b}

/* ---------- personal stats ---------- */
function weekOf(k){return addDays(k,-keyToDate(k).getDay())}
function myStats(){
  const en=Object.values(S.results[S.uid]||{});const today=todayKey();const month=today.slice(0,7),year=today.slice(0,4);
  const days=new Set(en.map(e=>e.wod).filter(Boolean));
  const monthCount=[...days].filter(d=>d.startsWith(month)).length;
  const weeks=new Set([...days].map(weekOf));let w=weekOf(today);if(!weeks.has(w))w=addDays(w,-7);let streak=0;while(weeks.has(w)){streak++;w=addDays(w,-7)}
  // count PRs set this year: walk results in date order and count every improvement over an earlier result
  const best={};let prs=0;
  for(const e of en.slice().sort((a,b)=>(a.wod+(a.ts||"")).localeCompare(b.wod+(b.ts||"")))){
    let k="",up=false;
    if(isWeightEntry(e)){k="w|"+normName(liftOfEntry(e));up=true}else{const b=benchKey(e);if(b){k="b|"+b+"|"+(e.rx?1:0)}}
    if(!k)continue;const prev=best[k];
    if(prev!=null&&(up?e.value>prev:better(e.type,e.value,prev))&&e.wod.startsWith(year))prs++;
    if(prev==null||(up?e.value>prev:better(e.type,e.value,prev)))best[k]=e.value;
  }
  const likes=S.likesMine.filter(l=>l.by!==S.uid).length;
  return {monthCount,streak,prs,likes};
}
function statsHTML(){
  const s=myStats();
  return `<div class="stats"><div class="stat"><b>${s.monthCount}</b><span>אימונים החודש</span></div><div class="stat"><b>${s.streak}</b><span>${s.streak===1?"שבוע ברצף":"שבועות ברצף"}</span></div><div class="stat"><b>${s.prs}</b><span>שיאים השנה</span></div><div class="stat"><b>${s.likes}</b><span>לייקים שקיבלת</span></div></div>`;
}

/* ---------- PR celebration ---------- */
function celebrate({title,lift,value,prevText,key}){
  const root=document.getElementById("fx-root");
  root.innerHTML=`<div class="celebrate" id="cel"><canvas id="confetti"></canvas><div class="cel-card" role="dialog" aria-label="${esc(title)}"><div class="trophy">🏆</div><h2>${esc(title)}</h2><div class="lift" dir="auto">${esc(lift)}</div><div class="big">${esc(value)}</div>${prevText?`<div class="prev">${esc(prevText)}</div>`:""}
    <div class="rowbtns">${key?`<button class="btn primary" data-share="${esc(key)}" data-sharepr="1">📸 שיתוף</button>`:""}<button class="btn" id="cel-close">סגירה</button></div></div></div>`;
  const close=()=>{root.innerHTML=""};
  document.getElementById("cel-close").onclick=close;document.getElementById("cel").onclick=e=>{if(e.target.id==="cel")close()};
  if(!window.matchMedia("(prefers-reduced-motion: reduce)").matches)confetti(document.getElementById("confetti"));
}
function confetti(cv){
  const dpr=Math.min(2,window.devicePixelRatio||1);const W=cv.width=innerWidth*dpr,H=cv.height=innerHeight*dpr;const ctx=cv.getContext("2d");
  const cols=["#ff6a13","#ffb21a","#ff8a3d","#f2431f","#fff1c2","#ffd166"];
  const ps=Array.from({length:150},()=>({x:W/2+(Math.random()-.5)*W*.2,y:H*.45,vx:(Math.random()-.5)*22*dpr,vy:(-Math.random()*22-8)*dpr,s:(5+Math.random()*7)*dpr,r:Math.random()*6,vr:(Math.random()-.5)*.3,c:cols[Math.random()*cols.length|0]}));
  const t0=performance.now();
  (function step(t){if(!cv.isConnected)return;const age=t-t0;ctx.clearRect(0,0,W,H);
    for(const p of ps){p.vy+=0.55*dpr;p.vx*=0.99;p.x+=p.vx;p.y+=p.vy;p.r+=p.vr;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.r);ctx.globalAlpha=Math.max(0,1-age/3200);ctx.fillStyle=p.c;ctx.fillRect(-p.s/2,-p.s/4,p.s,p.s/2);ctx.restore()}
    if(age<3200)requestAnimationFrame(step);else ctx.clearRect(0,0,W,H)})(t0);
}

/* ---------- share a result as an image (Instagram story size) ---------- */
function loadImg(src){return new Promise((ok,no)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=no;i.src=src})}
function pill(c,x,y,w,h,r){c.beginPath();if(c.roundRect)c.roundRect(x,y,w,h,r);else{c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath()}c.fill()}
function fitFont(ctx,text,weight,family,maxPx,maxW){let px=maxPx;do{ctx.font=`${weight} ${px}px ${family}`;if(ctx.measureText(text).width<=maxW)break;px-=4}while(px>24);return px}
async function resultImage(key,pr){
  const e=(S.results[S.uid]||{})[key];if(!e)return null;
  await Promise.all(['700 200px "Chakra Petch"','800 64px Rubik','600 48px Rubik','400 40px Rubik'].map(f=>document.fonts.load(f).catch(()=>{})));
  const logo=await loadImg("logo.png").catch(()=>null);
  const W=1080,H=1920,cv=document.createElement("canvas");cv.width=W;cv.height=H;const c=cv.getContext("2d");
  let g=c.createLinearGradient(0,0,0,H);g.addColorStop(0,"#1f1517");g.addColorStop(1,"#0e0a0b");c.fillStyle=g;c.fillRect(0,0,W,H);
  g=c.createRadialGradient(W/2,1000,40,W/2,1000,720);g.addColorStop(0,"rgba(255,106,19,.38)");g.addColorStop(1,"rgba(255,106,19,0)");c.fillStyle=g;c.fillRect(0,0,W,H);
  {const b=c.createLinearGradient(0,0,W,0);b.addColorStop(0,"#ff8a3d");b.addColorStop(.4,"#ff6a13");b.addColorStop(1,"#ffb21a");c.fillStyle=b;c.fillRect(0,0,W,14)}
  if(logo){const lw=560,lh=lw*logo.height/logo.width;c.drawImage(logo,(W-lw)/2,150,lw,lh)}
  c.textAlign="center";c.direction="rtl";
  c.fillStyle="#b5a9a6";c.font='400 42px Rubik';c.fillText(heDate(e.wod,{weekday:"long",day:"numeric",month:"long",year:"numeric"}),W/2,640);
  const name=curName(e);c.fillStyle="#f4efe9";fitFont(c,name,800,"Rubik",76,940);c.fillText(name,W/2,760);
  if(pr){c.font='800 56px Rubik';const t="🏆 שיא אישי חדש!";const tw=c.measureText(t).width+80;c.fillStyle="rgba(255,178,26,.16)";pill(c,(W-tw)/2,850,tw,96,48);c.fillStyle="#ffb21a";c.fillText(t,W/2,918)}
  const score=fmt(e.type,e.value);c.direction="ltr";fitFont(c,score,700,'"Chakra Petch"',250,960);
  const sg=c.createLinearGradient(W*.15,0,W*.85,0);sg.addColorStop(0,"#ff8a3d");sg.addColorStop(.45,"#ff6a13");sg.addColorStop(1,"#ffb21a");c.fillStyle=sg;c.fillText(score,W/2,1200);
  if(entryUsesRx(e)){const t=e.rx?"RX":"SCALED";c.font='700 44px "Chakra Petch"';const tw=c.measureText(t).width+56;c.fillStyle=e.rx?"#4fd18b":"#7aa7ff";pill(c,(W-tw)/2,1270,tw,72,14);c.fillStyle=e.rx?"#10261a":"#0d1a33";c.fillText(t,W/2,1320)}
  c.direction="rtl";
  if(e.note){c.fillStyle="#c9bec0";fitFont(c,e.note,400,"Rubik",40,900);c.fillText(e.note,W/2,1430)}
  c.fillStyle="#f4efe9";c.font='600 52px Rubik';c.fillText(S.users[S.uid]?.name||"",W/2,1600);
  c.fillStyle="#8a7f86";c.font='400 34px Rubik';c.direction="ltr";c.fillText("CrossFit Savoy · savoy-wod.web.app",W/2,1800);
  return await new Promise(ok=>cv.toBlob(ok,"image/png"));
}
async function openShare(key,pr){
  document.getElementById("fx-root").innerHTML="";
  const root=document.getElementById("sheet-root");
  root.innerHTML=`<div class="scrim" id="scrim"><div class="sheet" dir="rtl" role="dialog" aria-label="שיתוף התוצאה"><h3>שיתוף התוצאה</h3><div class="sharepv" id="sh-pv"><div class="hint">מכינים את התמונה…</div></div>
    <div class="rowbtns"><button class="btn primary" id="sh-go" style="flex:1" disabled>📤 שיתוף</button><button class="btn ghost" id="sh-close">סגירה</button></div></div></div>`;
  const close=()=>{root.innerHTML=""};document.getElementById("sh-close").onclick=close;document.getElementById("scrim").onclick=e=>{if(e.target.id==="scrim")close()};
  let blob=null;try{blob=await resultImage(key,pr)}catch(err){console.error("share image",err)}
  const pv=document.getElementById("sh-pv"),go=document.getElementById("sh-go");if(!pv)return;
  if(!blob){pv.innerHTML='<div class="err">לא הצלחנו ליצור את התמונה.</div>';return}
  const url=URL.createObjectURL(blob);pv.innerHTML=`<img src="${url}" alt="תמונת התוצאה לשיתוף">`;
  const file=new File([blob],"savoy-result.png",{type:"image/png"});const canShare=!!navigator.canShare?.({files:[file]});
  go.disabled=false;go.textContent=canShare?"📤 שיתוף לאינסטגרם / וואטסאפ":"⬇️ שמירת התמונה";
  // share() must run straight from the tap, so the image is prepared beforehand
  go.onclick=()=>{if(canShare){navigator.share({files:[file],title:"Savoy WOD"}).catch(()=>{})}else{const a=document.createElement("a");a.href=url;a.download="savoy-result.png";document.body.appendChild(a);a.click();a.remove();toast("התמונה נשמרה")}};
}

/* ---------- workout timer ---------- */
const TMODES={fortime:"For Time",amrap:"AMRAP",emom:"EMOM",intervals:"Tabata"};
const TDEF={fortime:{cap:20},amrap:{mins:12},emom:{every:60,rounds:10},intervals:{work:20,rest:10,rounds:8}};
let TCFG=(()=>{try{return JSON.parse(localStorage.getItem("savoyTimer")||"null")}catch{return null}})()||{mode:"amrap",...TDEF.amrap};
let T=null; // running timer
// Read timer settings out of a workout part's text ("AMRAP 12", "EMOM 10", "E2MOM 16", "Tabata", "Time cap 15").
function timerFor(p){
  if(!p||p.type==="load")return null;const t=(p.name+"\n"+(p.description||"")).replace(/’/g,"'");let m;
  if(/\btabata\b/i.test(t))return {mode:"intervals",work:20,rest:10,rounds:8};
  if((m=t.match(/\be(\d)mom\b[^\d\n]{0,6}(\d{1,2})/i))){const n=+m[1],tot=+m[2];return {mode:"emom",every:n*60,rounds:Math.max(1,Math.round(tot/n))}}
  if((m=t.match(/\bemom\b[^\d\n]{0,6}(\d{1,2})/i))||(m=t.match(/(\d{1,2})\s*(?:min(?:ute)?s?|')\s*emom/i)))return {mode:"emom",every:60,rounds:+m[1]};
  if((m=t.match(/\bamrap\b[^\d\n]{0,6}(\d{1,2})/i))||(m=t.match(/(\d{1,2})\s*(?:min(?:ute)?s?|')\s*amrap/i)))return {mode:"amrap",mins:+m[1]};
  const cap=t.match(/(?:time\s*cap|\btc\b|\bcap\b)\s*:?\s*(\d{1,2})/i);
  if(cap||/for\s*time|\brft\b|rounds?\s+for\b/i.test(t)||p.type==="time")return {mode:"fortime",cap:cap?+cap[1]:0};
  return null;
}
function tTotal(c){return c.mode==="amrap"?c.mins*60:c.mode==="emom"?c.every*c.rounds:c.mode==="intervals"?(c.work+c.rest)*c.rounds-c.rest:(c.cap||0)*60}
function mmss(s){s=Math.max(0,Math.ceil(s));return Math.floor(s/60)+":"+String(s%60).padStart(2,"0")}
function viewTimer(){
  const c=TCFG;const n=(id,label,val,min,max)=>`<label class="f">${label}<input type="number" inputmode="numeric" id="${id}" min="${min}" max="${max}" value="${val}"></label>`;
  let f="";
  if(c.mode==="fortime")f=n("t-cap","Time cap (דקות, 0 = בלי)",c.cap,0,90);
  if(c.mode==="amrap")f=n("t-mins","משך (דקות)",c.mins,1,90);
  if(c.mode==="emom")f=n("t-every","כל כמה שניות",c.every,10,600)+n("t-rounds","סבבים",c.rounds,1,99);
  if(c.mode==="intervals")f=n("t-work","עבודה (שניות)",c.work,5,600)+n("t-rest","מנוחה (שניות)",c.rest,0,600)+n("t-rounds","סבבים",c.rounds,1,99);
  const tot=tTotal(c);
  return `<div class="section-h">טיימר לאימון</div><div class="card"><div class="tmodes">${Object.entries(TMODES).map(([k,l])=>`<button data-tmode="${k}" class="${c.mode===k?"on":""}">${l}</button>`).join("")}</div>
    <div class="tfields">${f}</div><div class="tsum">${tot?`משך כולל: <b dir="ltr">${mmss(tot)}</b> · `:""}ספירה לאחור של 10 שניות לפני ההתחלה</div>
    <button class="btn primary" data-tstart="1" style="padding:14px;font-size:17px">▶ התחלה</button></div>
    <div class="hint" style="margin-top:10px">טיפ: באימון של היום יש כפתור ⏱ ליד חלקים עם AMRAP, EMOM, Tabata או Time cap, והטיימר נפתח מוגדר מראש.</div>`;
}
function syncTimerForm(){const g=id=>{const el=document.getElementById(id);return el?Math.max(+el.min||0,Math.min(+el.max||999,parseInt(el.value)||0)):null};
  const c=TCFG;[["t-cap","cap"],["t-mins","mins"],["t-every","every"],["t-rounds","rounds"],["t-work","work"],["t-rest","rest"]].forEach(([id,k])=>{const v=g(id);if(v!=null)c[k]=v});
  try{localStorage.setItem("savoyTimer",JSON.stringify(c))}catch{}}
let wakeLock=null;
async function keepAwake(on){try{if(on&&"wakeLock" in navigator)wakeLock=await navigator.wakeLock.request("screen");else if(!on&&wakeLock){await wakeLock.release();wakeLock=null}}catch{}}
document.addEventListener("visibilitychange",()=>{if(T&&!T.done&&!T.pausedAt&&document.visibilityState==="visible")keepAwake(true)});
function startTimer(cfg,link){
  unlockAudio();
  T={cfg:{...cfg},link:link||null,start:performance.now()+10000,paused:0,pausedAt:0,done:false,taps:0,lastSec:null,lastSeg:null};
  keepAwake(true);renderTimerOv();T.iv=setInterval(tickTimer,100);tickTimer();
}
function stopTimer(){if(T){clearInterval(T.iv)}T=null;keepAwake(false);document.getElementById("timer-root").innerHTML=""}
function timerState(){
  const c=T.cfg;const now=T.pausedAt||performance.now();const t=(now-T.start-T.paused)/1000;
  if(t<0)return {phase:"pre",label:"מתחילים בעוד",clock:Math.ceil(-t),left:-t,seg:"pre"};
  const tot=tTotal(c);if(tot&&t>=tot)return {phase:"done",label:"סיום!",clock:c.mode==="fortime"?mmss(tot):"0:00",seg:"done"};
  if(c.mode==="fortime")return {phase:"work",label:c.cap?`Time cap ${c.cap}:00`:"For Time",clock:mmss(Math.floor(t)),left:c.cap?tot-t:null,seg:"w"};
  if(c.mode==="amrap")return {phase:"work",label:`AMRAP ${c.mins}`,clock:mmss(tot-t),left:tot-t,seg:"w"};
  if(c.mode==="emom"){const i=Math.floor(t/c.every);const left=c.every-(t%c.every);return {phase:"work",label:`סבב ${i+1} / ${c.rounds}`,clock:mmss(left),left,seg:"e"+i}}
  const cyc=c.work+c.rest;const i=Math.floor(t/cyc);const inC=t%cyc;const work=inC<c.work;const left=work?c.work-inC:cyc-inC;
  return {phase:work?"work":"rest",label:`${work?"עבודה":"מנוחה"} · סבב ${i+1} / ${c.rounds}`,clock:mmss(left),left,seg:(work?"w":"r")+i};
}
function renderTimerOv(){
  if(!T)return;const c=T.cfg;const counter=c.mode==="amrap"||c.mode==="fortime";
  const linkPart=T.link?S.wods[T.link.date]?.parts?.find(p=>p.id===T.link.part):null;
  document.getElementById("timer-root").innerHTML=`<div class="timer-ov pre" id="tov"><div class="tov-top"><span class="ttl">${esc(TMODES[c.mode])}${linkPart?` · <span dir="auto">${esc(linkPart.name)}</span>`:""}</span><button class="btn ghost sm" data-tstop="1" style="color:#b5a9a6;border-color:#3a3236">✕ סגירה</button></div>
    <div class="tov-mid"><div class="tov-phase" id="tov-phase"></div><div class="tov-clock" id="tov-clock"></div><div class="tov-sub" id="tov-sub"></div>
    ${counter?`<div class="tov-rounds"><button class="tov-round-btn" data-ttap="1">+1 סבב</button><span>סבבים: <b id="tov-taps">0</b></span></div>`:""}</div>
    <div class="tov-bot" id="tov-bot"></div></div>`;
}
function tickTimer(){
  if(!T)return;const s=timerState();const c=T.cfg;
  const ov=document.getElementById("tov");if(!ov){clearInterval(T.iv);return}
  ov.className="timer-ov "+(s.phase==="done"?"":s.phase);
  document.getElementById("tov-phase").textContent=s.phase==="pre"?"מתכוננים":s.phase==="done"?"":s.phase==="rest"?"REST":"GO";
  document.getElementById("tov-clock").textContent=s.clock;document.getElementById("tov-sub").textContent=s.label;
  const tp=document.getElementById("tov-taps");if(tp)tp.textContent=T.taps;
  // sounds: 3-2-1 beeps before each segment ends, a long tone when a segment starts, three tones at the end
  if(!T.pausedAt&&s.phase!=="done"){
    if(s.seg!==T.lastSeg){if(T.lastSeg!==null)chime("go");T.lastSeg=s.seg}
    const sec=s.left!=null?Math.ceil(s.left):null;if(sec!==T.lastSec){if(sec!=null&&sec<=3&&sec>=1)chime("beep");T.lastSec=sec}
  }
  const bot=document.getElementById("tov-bot");
  if(s.phase==="done"){
    if(!T.done){T.done=true;clearInterval(T.iv);chime("end");keepAwake(false)}
    const canLog=T.link&&(c.mode==="amrap"||c.mode==="fortime");
    bot.innerHTML=`${canLog?`<button class="btn primary" data-tlog="1">הזנת תוצאה</button>`:""}<button class="btn" data-tagain="1">שוב</button><button class="btn" data-tstop="1">סיום</button>`;return;
  }
  const want=T.pausedAt?"paused":"running";if(bot.dataset.st===want)return;bot.dataset.st=want;
  bot.innerHTML=T.pausedAt?`<button class="btn primary" data-tresume="1">▶ המשך</button><button class="btn" data-tagain="1">↺ מההתחלה</button>`
    :`<button class="btn" data-tpause="1">⏸ השהיה</button>${c.mode==="fortime"?`<button class="btn primary" data-tfinish="1">✓ סיימתי</button>`:""}`;
}
function timerClick(t){
  if(t.dataset.tstop){stopTimer();return true}
  if(!T)return false;
  if(t.dataset.ttap){T.taps++;chime("beep");tickTimer();return true}
  if(t.dataset.tpause){T.pausedAt=performance.now();keepAwake(false);tickTimer();return true}
  if(t.dataset.tresume){T.paused+=performance.now()-T.pausedAt;T.pausedAt=0;keepAwake(true);tickTimer();return true}
  if(t.dataset.tagain){const {cfg,link}=T;stopTimer();startTimer(cfg,link);return true}
  if(t.dataset.tfinish){T.pausedAt=performance.now();const el=(T.pausedAt-T.start-T.paused)/1000;T.finishAt=Math.max(1,Math.round(el));T.done=true;clearInterval(T.iv);chime("end");keepAwake(false);
    document.getElementById("tov-clock").textContent=mmss(T.finishAt);document.getElementById("tov-sub").textContent="הזמן שלך";document.getElementById("tov").className="timer-ov";
    document.getElementById("tov-bot").innerHTML=`${T.link?'<button class="btn primary" data-tlog="1">הזנת הזמן</button>':""}<button class="btn" data-tstop="1">סיום</button>`;return true}
  if(t.dataset.tlog){const {link,cfg,taps,finishAt}=T;stopTimer();S.date=link.date;S.tab="wod";render();
    const p=S.wods[link.date]?.parts?.find(x=>x.id===link.part);if(!p)return true;
    let value=null;if(cfg.mode==="fortime"&&finishAt)value=finishAt;else if(p.type==="rounds"&&taps)value=taps*1000;
    openLog(link.part,value);return true}
  return false;
}

/* ---------- push notifications ---------- */
const isIOS=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
const standalone=window.matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
function pushState(){
  if(!("Notification" in window)||!("serviceWorker" in navigator))return isIOS&&!standalone?"ios-install":"unsupported";
  return Notification.permission; // "default" | "granted" | "denied"
}
async function registerPush(silent){
  try{
    const { getMessaging, getToken, isSupported } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js");
    if(!(await isSupported()))throw new Error("unsupported");
    const reg=await navigator.serviceWorker.register("sw.js");await navigator.serviceWorker.ready;
    const token=await getToken(getMessaging(fb),{serviceWorkerRegistration:reg});
    if(!token)throw new Error("no-token");
    const cur=S.users[S.uid]?.fcmTokens||[];
    if(!cur.includes(token))await setDoc(doc(db,"users",S.uid),{fcmTokens:[...cur.filter(Boolean).slice(-4),token]},{merge:true});
    if(!silent)toast("🔔 התראות הופעלו! תקבלו התראה כשמישהו נותן לייק.");
    return true;
  }catch(e){console.error("push",e);if(!silent)toast("לא הצלחנו להפעיל התראות במכשיר הזה.");return false}
}
async function enablePush(){
  const st=pushState();
  if(st==="ios-install"){toast("באייפון: קודם מוסיפים את האפליקציה למסך הבית, ופותחים אותה משם.");return}
  if(st==="unsupported"){toast("הדפדפן הזה לא תומך בהתראות.");return}
  if(st==="denied"){toast("ההתראות חסומות. אפשר להפעיל אותן בהגדרות הטלפון ← Savoy.");return}
  const perm=st==="granted"?"granted":await Notification.requestPermission();
  if(perm==="granted")await registerPush(false);
  renderPushCard();
}
function pushCardHTML(){
  const st=pushState();const has=(S.users[S.uid]?.fcmTokens||[]).length>0;
  if(st==="granted"&&has)return `<div class="pushcard ok">🔔 התראות לטלפון פועלות</div>`;
  if(st==="denied")return `<div class="pushcard">🔕 ההתראות חסומות. אפשר להפעיל אותן בהגדרות הטלפון ← Savoy.</div>`;
  if(st==="ios-install")return `<div class="pushcard">🔔 כדי לקבל התראות באייפון, מוסיפים את האפליקציה למסך הבית ופותחים אותה משם. <a href="install.html">איך?</a></div>`;
  if(st==="unsupported")return "";
  return `<div class="pushcard"><div>🔔 לקבל התראה כשמישהו נותן לייק לתוצאה שלך?</div><button class="btn primary sm" data-enablepush="1">הפעלת התראות</button></div>`;
}
function renderPushCard(){const el=document.getElementById("pushcard-slot");if(el)el.innerHTML=pushCardHTML()}
function openLikes(){
  const list=S.likesMine.filter(l=>l.by!==S.uid).sort((a,b)=>b.ts.localeCompare(a.ts)).slice(0,60);const seen=S.users[S.uid]?.likesSeen||"";
  document.getElementById("sheet-root").innerHTML=`<div class="scrim" id="scrim"><div class="sheet" dir="rtl" role="dialog" aria-label="התראות"><h3>התראות</h3>
    <div id="pushcard-slot">${pushCardHTML()}</div>
    <div class="rowbtns"><button class="linkbtn" data-togglesound="1">${soundOn()?"🔊 צלילים: פועל":"🔇 צלילים: כבוי"}</button><button class="linkbtn" data-toggletheme="1">${isDark()?"☀️ מעבר לתצוגה בהירה":"🌙 מעבר לתצוגה כהה"}</button></div>
    ${list.length?`<div class="hist">${list.map(l=>`<button class="hrow notif ${l.ts>seen?"new":""}" data-goto="${esc(l.wod)}" style="background:none;border:0;border-top:1px solid var(--line2);text-align:right;width:100%"><div class="tcell"><img src="${avatarFor(l.by)}" alt=""><div><div class="p">❤️ ${esc(likeText(l))}</div><div class="d">${esc(heDate(l.wod,{weekday:"short",day:"numeric",month:"short"}))}</div></div></div></button>`).join("")}</div>`:'<div class="empty" style="padding:6px 0">עוד אין התראות. כשמישהו ייתן לייק לתוצאה שלך, זה יופיע כאן.</div>'}
    <div class="rowbtns"><button class="btn ghost" type="button" id="n-close">סגירה</button></div></div></div>`;
  const close=()=>document.getElementById("sheet-root").innerHTML="";
  document.getElementById("scrim").onclick=e=>{if(e.target.id==="scrim"||e.target.closest("[data-goto]"))close()};document.getElementById("n-close").onclick=close;
  if(list.length&&list[0].ts>seen)setDoc(doc(db,"users",S.uid),{likesSeen:list[0].ts},{merge:true}).catch(()=>{});
}
function render(skipSync){
  subDayLikes();
  if(S.tab==="coach"&&!skipSync){syncDraft();syncWeek()}
  renderWho();renderTabs();
  const v=document.getElementById("view");
  v.innerHTML=S.tab==="me"?viewMe():S.tab==="coach"?viewCoach():S.tab==="timer"?viewTimer():viewWod();
}
function renderWho(){
  const el=document.getElementById("who");
  const n=unseenLikes().length;
  el.innerHTML=`<button class="bell" id="bell" type="button" aria-label="התראות${n?`, ${n} חדשות`:""}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>${n?`<b>${n>9?"9+":n}</b>`:""}</button><span></span><img alt=""><button class="linkbtn" id="logout" type="button">יציאה</button>`;
  el.querySelector("span").textContent=S.users[S.uid]?.name||"";
  el.querySelector("img").src=avatarFor(S.uid);
}
function renderTabs(){
  const tabs=[["wod","אימון"],["timer","טיימר"],["me","התוצאות שלי"]];if(S.isCoach)tabs.push(["coach","מאמן"]);
  document.getElementById("tabs").innerHTML=tabs.map(([k,l])=>`<button data-tab="${k}" class="${S.tab===k?"on":""}">${ICON[k]}<span>${l}</span></button>`).join("");
}
function weekStrip(){
  const sel=keyToDate(S.date);const start=addDays(S.date,-sel.getDay());const today=todayKey();let days="";
  for(let i=0;i<7;i++){const k=addDays(start,i);const d=keyToDate(k);
    days+=`<button class="day ${k===S.date?"sel":""} ${k===today?"today":""} ${S.wods[k]?"has":""}" data-date="${k}" aria-label="${esc(heDate(k))}"><span class="dn">${d.toLocaleDateString("he-IL",{weekday:"short"})}</span><span class="dd">${d.getDate()}</span><span class="dot"></span></button>`}
  return `<div class="week"><button class="arrow" data-week="-7" aria-label="שבוע קודם">›</button><div class="days">${days}</div><button class="arrow" data-week="7" aria-label="שבוע הבא">‹</button></div>`;
}
function genderOk(e){return S.gender==="all"||S.users[e.uid]?.gender===S.gender}
function viewControls(){
  const g=[["all","כולם"],["male","גברים"],["female","נשים"]].map(([k,l])=>`<button data-gender="${k}" class="${S.gender===k?"on":""}">${l}</button>`).join("");
  const m=[["parts","לפי חלקים"],["table","טבלת היום"]].map(([k,l])=>`<button data-mode="${k}" class="${S.mode===k?"on":""}">${l}</button>`).join("");
  return `<div class="controls"><div class="filters">${m}</div><div class="filters">${g}</div></div>`;
}
function viewTable(w){
  const parts=w.parts.filter(p=>p.type!=="none");
  if(!parts.length)return '<div class="state">אין היום חלקים עם תוצאה.</div>';
  const day=allEntries().filter(e=>e.wod===S.date&&genderOk(e));
  const uids=[...new Set(day.map(e=>e.uid))];
  if(!uids.length)return '<div class="state"><img src="'+EMBLEM+'" alt=""><h3>עוד אין תוצאות היום</h3><div>ברגע שמתאמנים יזינו תוצאות, הן יופיעו כאן בטבלה אחת.</div></div>';
  const first=parts[0];
  const val=(uid,p)=>day.find(e=>e.uid===uid&&e.part===p.id);
  uids.sort((a,b)=>{const x=val(a,first),y=val(b,first);if(!x&&!y)return 0;if(!x)return 1;if(!y)return -1;if(usesRx(first)&&!!y.rx!==!!x.rx)return y.rx?1:-1;return TYPES[first.type].better==="low"?x.value-y.value:y.value-x.value});
  let h='<div class="tablewrap"><table class="daytable"><thead><tr><th>מתאמן/ת</th>'+parts.map(p=>`<th><span class="tag sm">${esc(p.label||"•")}</span> <span dir="auto">${esc(p.name)}</span></th>`).join("")+'</tr></thead><tbody>';
  for(const uid of uids){
    h+=`<tr class="${uid===S.uid?"me":""}"><td><div class="tcell"><img src="${avatarFor(uid)}" alt=""><span>${esc(nameFor(uid))}</span></div></td>`;
    for(const p of parts){const e=val(uid,p);h+=e?`<td><b dir="ltr">${esc(fmt(p.type,e.value))}</b>${usesRx(p)?` <span class="badge ${e.rx?"rx":"sc"}">${e.rx?"RX":"SC"}</span>`:""}</td>`:'<td class="nil">—</td>'}
    h+="</tr>";
  }
  return h+"</tbody></table></div>";
}
function viewWod(){
  const w=S.wods[S.date];const isToday=S.date===todayKey();
  let h=weekStrip()+`<div class="dateline"><h1>${isToday?"היום":esc(heDate(S.date,{weekday:"long"}))}</h1><span class="t">${esc(heDate(S.date,{day:"numeric",month:"long",year:"numeric"}))}</span></div>`;
  if(!S.ready)return h+`<div class="state"><img src="${EMBLEM}" alt=""><h3>טוען את האימון…</h3></div>`;
  if(!w||!w.parts?.length)return h+`<div class="state"><img src="${EMBLEM}" alt=""><h3>עוד לא עלה אימון ליום הזה</h3><div>${S.isCoach?'אפשר להעלות אותו בלשונית "מאמן".':"האימון יופיע כאן ברגע שהמאמן יעלה אותו."}</div>${S.isCoach?'<div style="margin-top:12px"><button class="btn primary" data-tab="coach">העלאת אימון</button></div>':""}</div>`+bookingHTML();
  if(w.title)h+=`<p class="wodtitle">${esc(w.title)}</p>`;
  if(S.isCoach&&S.importStatus?.ok===false)h+=importBanner();
  if(S.isCoach)h+=`<div style="margin-top:10px"><button class="btn" data-editwod="1">✏️ עריכת האימון</button>${w.source==="arbox"?' <span class="hint">נמשך אוטומטית מ-Arbox</span>':""}</div>`;
  h+=viewControls();
  if(S.mode==="table")return h+viewTable(w);
  h+='<div class="parts">';
  for(const p of w.parts){
    const rx=usesRx(p);const list=rankEntries(entriesFor(S.date,p.id),p.type,rx);const f=rx?(S.filter[p.id]||"all"):"all";
    const shown=list.filter(e=>genderOk(e)&&(f==="all"||(f==="rx"?e.rx:!e.rx)));const mine=list.find(e=>e.uid===S.uid);
    h+=`<section class="part"><div class="part-head"><span class="tag">${esc(p.label||"•")}</span><div>${p.category&&p.category!==p.name?`<div class="pcat">${esc(p.category)}</div>`:""}<h2 dir="auto">${esc(p.name)}</h2><div class="ptype">${esc(TYPES[p.type]?.label||"")}</div></div></div>`;
    if(p.description)h+=`<div class="desc" dir="auto">${esc(p.description)}</div>`;
    h+=pctBox(p);
    if(p.type!=="none"){
      h+=`<div class="part-actions"><button class="btn ${mine?"":"primary"}" data-log="${esc(p.id)}">${mine?"עריכת התוצאה":"הזנת תוצאה"}</button>${mine?`<span class="mine-chip">שלי: <b dir="ltr">${esc(fmt(p.type,mine.value))}</b></span><button class="btn ghost sm" data-share="${esc(mine.key)}" aria-label="שיתוף התוצאה">📸 שיתוף</button>`:""}${timerFor(p)?`<button class="btn ghost sm timer-link" data-timerpart="${esc(p.id)}" aria-label="טיימר לחלק הזה">⏱ טיימר</button>`:""}</div>`;
      h+=`<div class="board"><div class="board-head"><span>לוח תוצאות · ${list.length}</span>${rx?`<div class="filters">${["all","rx","sc"].map(k=>`<button data-filter="${esc(p.id)}" data-f="${k}" class="${f===k?"on":""}">${k==="all"?"הכול":k==="rx"?"RX":"Scaled"}</button>`).join("")}</div>`:""}</div>`;
      if(!shown.length)h+='<div class="empty">עוד אין תוצאות. תהיו הראשונים.</div>';
      shown.forEach((e,i)=>{h+=`<div class="row ${e.uid===S.uid?"me":""}"><span class="rank">${i+1}</span><img src="${avatarFor(e.uid)}" alt=""><div class="nm"><div class="n">${esc(nameFor(e.uid))}</div>${e.note?`<div class="note" dir="auto">${esc(e.note)}</div>`:""}</div><div class="score"><b>${esc(fmt(p.type,e.value))}</b>${rx?`<span class="badge ${e.rx?"rx":"sc"}">${e.rx?"RX":"SCALED"}</span>`:""}</div>${likeBtn(e.uid,p.id)}</div>`});
      h+="</div>";
    }else h+=timerFor(p)?`<div class="part-actions"><button class="btn ghost sm timer-link" data-timerpart="${esc(p.id)}">⏱ טיימר</button></div>`:'<div style="height:14px"></div>';
    h+="</section>";
  }
  return h+"</div>"+bookingHTML();
}
function pctLines(p){
  const out=[];const lines=((p.name||"")+"\n"+(p.description||"")).split("\n");
  for(const line of lines){if(!line.includes("%"))continue;
    // numbers followed by % (allows "78%", "85+ %", "80-85%", "@ 75 %")
    const pcts=[...line.matchAll(/(\d{2,3}(?:\.\d+)?)(\s*\+)?(?=[\s+\-–.\d]*%)/g)].map(m=>({v:+m[1],plus:!!m[2]||/^\s*%\s*\+/.test(line.slice(m.index+m[0].length))})).filter(x=>x.v>=30&&x.v<=120);if(!pcts.length)continue;
    // "of your C&J" / "from 1RM back squat" names the base lift explicitly
    const ofm=line.match(/(?:\bof|\bfrom)\s+(?:your\s+|the\s+|1\s*rm\s+)*(.+)$/i);
    const lift=(ofm&&detectLift(ofm[1]))||detectLift(line)||p.lift||detectLift(p.name)||detectLift(p.description);if(!lift)continue;
    let g=out.find(x=>x.lift===lift);if(!g){g={lift,pcts:[]};out.push(g)}pcts.forEach(x=>{if(!g.pcts.some(y=>y.v===x.v))g.pcts.push(x)})}
  return out;
}
function pctBox(p){
  const groups=pctLines(p);if(!groups.length||!S.uid)return "";
  let h='<div class="pctbox">';
  for(const g of groups){const base=oneRM(S.uid,g.lift);
    if(!base){h+=`<div class="pct-h">המשקלים שלך · <span dir="ltr">${esc(g.lift)}</span></div><div class="pct-empty">הזינו 1RM ב-<span dir="ltr">${esc(g.lift)}</span> ונחשב לכם את המשקלים לפי האחוזים. <button class="btn ghost sm" data-addrm="${esc(g.lift)}">הזנת 1RM</button></div>`;continue}
    h+=`<div class="pct-h">המשקלים שלך · <span dir="ltr">${esc(g.lift)}</span> <span class="pct-base">${base.est?`1RM משוער מ-${base.from}RM`:"לפי 1RM"} <b dir="ltr">${esc(fmt("load",round05(base.value)))}</b></span></div><div class="pct-chips">`+g.pcts.map(x=>`<span class="pct-chip"><i dir="ltr">${x.v}%${x.plus?"+":""}</i><b dir="ltr">${x.plus?"":""}${esc(fmt("load",round05(base.value*x.v/100)))}${x.plus?"+":""}</b></span>`).join("")+"</div>";}
  return h+"</div>";
}
function curName(e){return S.wods[e.wod]?.parts?.find(p=>p.id===e.part)?.name||e.partName}
function viewMe(){
  const mine=Object.entries(S.results[S.uid]||{}).map(([k,e])=>({key:k,...e}));
  const recs=rmRecords(S.uid);
  const rmBtn='<button class="btn primary" data-addrm="">+ הוספת RM</button>';
  const pc=pushCardHTML();const pushTop=pc&&!pc.includes("pushcard ok")?`<div id="pushcard-slot" style="margin-top:12px">${pc}</div>`:"";
  if(!mine.length&&!recs.length)return pushTop+`<div class="state"><img src="${EMBLEM}" alt=""><h3>עוד אין תוצאות</h3><div>הזינו תוצאה באימון של היום, או הוסיפו את ה-1RM שלכם כדי שנחשב לכם משקלים לפי אחוזים.</div><div style="margin-top:12px">${rmBtn}</div></div>`;
  let h=pushTop+(mine.length?statsHTML():"");
  // working-weight PRs (Strength / Weightlifting only)
  const prs={};for(const e of mine){if(!isWeightEntry(e))continue;const lift=liftOfEntry(e);const k=normName(lift);if(!prs[k]||e.value>prs[k].value)prs[k]={...e,lift}}
  const prList=Object.values(prs).sort((a,b)=>b.value-a.value);
  if(prList.length)h+='<div class="section-h">שיאים אישיים · משקלי עבודה</div><div class="prs">'+prList.map(e=>`<div class="pr"><div class="k" dir="ltr">${esc(e.lift)}</div><div class="v">${esc(fmt("load",e.value))}</div><div class="d">${esc(heDate(e.wod,{day:"numeric",month:"short",year:"2-digit"}))}</div></div>`).join("")+"</div>";
  // rep maxes
  const lifts=[...new Set(recs.map(r=>r.lift))].sort();
  h+=`<div class="section-h rmhead"><span>מקסימום (RM)</span>${rmBtn}</div>`;
  if(lifts.length){
    h+='<div class="tablewrap"><table class="daytable rmtable"><thead><tr><th>תרגיל</th>'+RM_REPS.map(n=>`<th dir="ltr">${n}RM</th>`).join("")+'</tr></thead><tbody>'+lifts.map(l=>`<tr><td dir="ltr" style="text-align:left">${esc(l)}</td>`+RM_REPS.map(n=>{const b=bestRM(S.uid,l,n);return b?`<td><b dir="ltr">${esc(fmt("load",b.value))}</b></td>`:'<td class="nil">—</td>'}).join("")+"</tr>").join("")+"</tbody></table></div>";
    const hist=recs.slice().sort((a,b)=>(b.date||"").localeCompare(a.date||""));
    h+='<div class="hist" style="margin-top:10px">'+hist.slice(0,30).map(r=>`<div class="hrow"><div><div class="p" dir="ltr" style="text-align:right">${esc(r.lift)} · ${r.reps}RM</div><div class="d">${esc(heDate(r.date,{weekday:"short",day:"numeric",month:"short",year:"2-digit"}))}${r.src==="log"?" · מהאימון":""}</div></div><div class="score" style="flex-direction:row;gap:10px;align-items:center"><b>${esc(fmt("load",r.value))}</b>${r.src==="manual"?`<button class="btn ghost danger sm" data-delrm="${esc(r.id)}">מחיקה</button>`:""}</div></div>`).join("")+"</div>";
  }else h+='<div class="empty" style="padding:0 2px">עוד לא הוזן RM. הוסיפו 1RM, 2RM, 3RM או 5RM, והאפליקציה תחשב לכם משקלים כשיש אחוזים באימון.</div>';
  if(!mine.length)return h;
  mine.sort((a,b)=>a.wod<b.wod?1:a.wod>b.wod?-1:0);
  h+='<div class="section-h">היסטוריה</div><div class="hist">'+mine.map(e=>`<button class="hrow" style="background:none;border:0;border-top:1px solid var(--line2);text-align:right;width:100%" data-goto="${esc(e.wod)}"><div><div class="p" dir="auto">${esc(curName(e))}${(isWeightEntry(e)&&bestWorking(S.uid,liftOfEntry(e))?.key===e.key)||isBenchBest(e)?' <span class="prtag">PR</span>':""}</div><div class="d">${esc(heDate(e.wod,{weekday:"short",day:"numeric",month:"short"}))}${e.note?" · "+esc(e.note):""}</div></div><div class="score"><b>${esc(fmt(e.type,e.value))}</b>${entryUsesRx(e)?`<span class="badge ${e.rx?"rx":"sc"}">${e.rx?"RX":"SCALED"}</span>`:""}</div></button>`).join("")+"</div>";
  return h;
}
function partNote(d,p){
  const n=entriesFor(d.date,p.id).length;if(!n)return "";
  const orig=S.wods[d.date]?.parts.find(o=>o.id===p.id);
  const warn=orig&&orig.type!==p.type?` שינוי סוג התוצאה ישבש את התוצאות האלה.`:"";
  return `<div class="full hint" style="color:${warn?"var(--danger)":"var(--good)"}">כבר נרשמו ${n} תוצאות לחלק הזה, והן יישמרו.${warn}</div>`;
}
function removedWithResults(d){const old=S.wods[d.date]?.parts||[];return old.filter(o=>!d.parts.some(p=>p.id===o.id)).map(o=>({o,n:entriesFor(d.date,o.id).length})).filter(x=>x.n)}
function importBanner(){
  const st=S.importStatus;if(!S.isCoach||!st)return "";
  const when=st.lastRun?new Date(st.lastRun).toLocaleString("he-IL",{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}):"";
  if(st.ok===false)return `<div class="banner warn"><b>⚠️ המשיכה האוטומטית מ-Arbox נכשלה</b> (${esc(when)}). אפשר להדביק את האימונים ידנית בלשונית "מאמן". פרטים: ${esc(st.message||"")}</div>`;
  return `<div class="banner">🔄 משיכה אחרונה מ-Arbox: ${esc(when)} · ${esc(st.message||"")}</div>`;
}
function nextWeekStart(){const d=new Date();const day=d.getDay();const add=day>=5?7-day:-day;d.setDate(d.getDate()+add);return todayKey(d)}
function viewWeekImport(){
  if(!S.week)S.week={start:nextWeekStart(),text:"",days:null};
  const w=S.week;
  let h=`<div class="section-h">ייבוא שבועי · כל השבוע בהדבקה אחת</div><div class="card">
    <label class="f">השבוע שמתחיל ביום ראשון<input type="date" id="w-start" value="${esc(w.start)}"></label>
    <label class="f">הדבקת כל אימוני השבוע<textarea id="w-text" style="min-height:190px" placeholder="מעתיקים מ-Arbox את כל השבוע. כל יום מתחיל בשורה עם שם היום או התאריך, לדוגמה:&#10;יום ראשון&#10;A. Strength&#10;Back Squat 5x3 @ 78%&#10;B. Metcon&#10;AMRAP 12 ...&#10;&#10;יום שני&#10;...">${esc(w.text)}</textarea></label>
    <div class="hint">מזהה ימים לפי "יום ראשון" / "יום א׳" / "Sunday" / תאריך כמו 9.11. כל יום מתפרק לחלקים כמו בהעלאה רגילה.</div>
    <div class="rowbtns"><button class="btn primary" id="w-split">חלוקה לימים</button></div>`;
  if(w.days){
    if(!w.days.length)h+='<div class="err">לא זוהו ימים בטקסט. ודאו שכל יום מתחיל בשורה נפרדת עם שם היום או התאריך.</div>';
    else{
      h+=`<div class="weekprev">`+w.days.map((d,i)=>{const ex=S.wods[d.date];const n=ex?ex.parts.reduce((a,p)=>a+entriesFor(d.date,p.id).length,0):0;
        return `<label class="wday ${d.include?"":"off"}"><input type="checkbox" data-wday="${i}" ${d.include?"checked":""}><div><div class="wd-h">${esc(heDate(d.date,{weekday:"long",day:"numeric",month:"numeric"}))}</div><div class="wd-p">${d.parts.map(p=>`<span>${esc(p.label)}. ${esc(p.category||p.name)}</span>`).join("")}</div>${ex?`<div class="wd-warn">יחליף אימון קיים${n?` · ${n} תוצאות יישמרו`:""}</div>`:""}</div></label>`}).join("")+`</div>`;
      h+=`<div class="rowbtns"><button class="btn primary" id="w-publish">פרסום ${w.days.filter(d=>d.include).length} ימים</button></div><div class="err" id="w-err"></div>`;
    }
  }
  return h+"</div>";
}
function viewCoach(){
  if(!S.isCoach)return "";
  if(!S.draft){const ex=S.wods[S.date];S.draft={date:S.date,text:"",title:ex?.title||"",parts:ex?JSON.parse(JSON.stringify(ex.parts)):[],members:""}}
  const d=S.draft;
  let h=importBanner()+`<div class="section-h">${S.wods[d.date]?"עריכת אימון קיים":"העלאת אימון"}</div><div class="card">
    <label class="f">תאריך<input type="date" id="c-date" value="${esc(d.date)}"></label>
    <label class="f">הדבקת טקסט האימון<textarea id="c-text" placeholder="הדביקו כאן את האימון כמו שהוא מופיע ב-Arbox, לדוגמה:&#10;A. Back Squat&#10;5-5-3-3-1&#10;B. Metcon&#10;For time: 21-15-9 Thrusters, Pull-ups">${esc(d.text)}</textarea></label>
    <div class="hint">האפליקציה מזהה חלקים לפי שורות שמתחילות ב-A. / B. / Part A, או במילים כמו Warm-up, Strength, Metcon, חימום, כוח. אחרי הפירוק אפשר לתקן הכול.</div>
    <div class="rowbtns"><button class="btn primary" id="c-parse">פירוק לחלקים</button><button class="btn ghost" id="c-addpart">הוספת חלק ידנית</button></div></div>`;
  if(d.parts.length){
    h+=`<div class="section-h">תצוגה מקדימה · ${d.parts.length} חלקים</div><div class="card"><label class="f">כותרת היום (לא חובה)<input type="text" id="c-title" value="${esc(d.title)}" placeholder="למשל: Hero WOD"></label>`;
    d.parts.forEach((p,i)=>{h+=`<div class="pedit" data-i="${i}"><div class="full catchips">${CATS.map(c=>`<button type="button" class="${p.category===c?"on":""}" data-cat="${c}" data-ci="${i}">${c}</button>`).join("")}</div><label class="f">אות<input type="text" data-k="label" value="${esc(p.label)}" maxlength="4"></label><label class="f">שם החלק<input type="text" data-k="name" value="${esc(p.name)}"></label>${WEIGHT_CATS.has(p.category)?`<label class="f full">תרגיל (לשיאים ולחישוב אחוזים)${p.liftOther?`<input type="text" data-k="lift" dir="ltr" value="${esc(p.lift||"")}" placeholder="שם התרגיל (באנגלית)">`:`<select data-k="lift" data-liftsel="${i}" dir="ltr">${liftOptions(p.lift||"")}</select>`}</label>`:""}<label class="f full">סוג תוצאה<select data-k="type">${Object.entries(TYPES).map(([k,t])=>`<option value="${k}" ${p.type===k?"selected":""}>${esc(t.label)}</option>`).join("")}</select></label><textarea data-k="description" placeholder="תיאור">${esc(p.description)}</textarea>${partNote(d,p)}<div class="full"><button class="btn ghost danger" data-rmpart="${i}">הסרת החלק</button></div></div>`});
    h+=`<div class="rowbtns"><button class="btn primary" id="c-save">שמירה ופרסום למתאמנים</button>${S.wods[d.date]?'<button class="btn ghost danger" id="c-del">מחיקת האימון של היום הזה</button>':""}</div><div class="err" id="c-err"></div></div>`;
  }
  h+=viewWeekImport();
  h+=`<div class="section-h">מתאמנים מורשים · ${S.members.length}</div><div class="card">
    <div class="hint">רק כתובות Gmail שברשימה יכולות להיכנס. בהמשך הרשימה תתעדכן אוטומטית מ-Arbox.</div>
    <label class="f">הוספת מתאמנים (כתובת אחת בכל שורה, או מופרדות בפסיקים)<textarea id="c-members" style="min-height:90px" dir="ltr" placeholder="dana@gmail.com&#10;yossi@gmail.com">${esc(d.members)}</textarea></label>
    <div class="rowbtns"><button class="btn primary" id="c-addmembers">הוספה</button></div>
    ${S.members.length?`<div class="mlist">${S.members.map(m=>`<div class="mrow"><span>${esc(m)}</span><button class="btn ghost danger" data-rmmember="${esc(m)}">הסרה</button></div>`).join("")}</div>`:""}</div>`;
  return h;
}

/* ---------- log sheet ---------- */
function openLog(partId,preValue){
  const w=S.wods[S.date];const p=w?.parts.find(x=>x.id===partId);if(!p)return;
  const key=S.date+"__"+p.id;const ex=(S.results[S.uid]||{})[key];const v=preValue??ex?.value;let inputs="";
  const isAmrap=p.type==="reps"&&/amrap/i.test(p.name+" "+p.description);
  if(p.type==="time")inputs=`<div class="nums"><label class="f">דקות<input type="number" inputmode="numeric" min="0" id="l-a" value="${v!=null?Math.floor(v/60):""}"></label><span class="sep">:</span><label class="f">שניות<input type="number" inputmode="numeric" min="0" max="59" id="l-b" value="${v!=null?Math.round(v%60):""}"></label></div>`;
  else if(p.type==="rounds")inputs=`<div class="nums"><label class="f">סבבים<input type="number" inputmode="numeric" min="0" id="l-a" value="${v!=null?Math.floor(v/1000):""}"></label><span class="sep">+</span><label class="f">חזרות<input type="number" inputmode="numeric" min="0" id="l-b" value="${v!=null?Math.round(v%1000):""}"></label></div>`;
  else if(p.type==="load")inputs=`<div class="nums"><label class="f">משקל (ק״ג)<input type="number" inputmode="decimal" min="0" step="0.5" id="l-a" value="${v??""}"></label></div>`;
  else inputs=`<div class="nums"><label class="f">${isAmrap?"סך הכול חזרות":"חזרות"}<input type="number" inputmode="numeric" min="0" id="l-a" value="${v??""}"></label></div>`;
  const rx=ex?!!ex.rx:true;
  document.getElementById("sheet-root").innerHTML=`<div class="scrim" id="scrim"><form class="sheet" id="logform" novalidate dir="rtl" role="dialog" aria-label="הזנת תוצאה">
    <h3 dir="auto">${esc(p.label?p.label+". ":"")}${esc(p.name)}</h3><div class="sub">${esc(TYPES[p.type].label)}${p.type==="load"&&rmOf(p)?` · יישמר גם כ-<b dir="ltr">${rmOf(p)}RM</b> ב-<span dir="ltr">${esc(p.lift||detectLift(p.name+"\n"+p.description)||p.name)}</span>`:""}</div>${inputs}
    ${usesRx(p)?`<div class="seg" id="l-rx"><button type="button" class="rx ${rx?"on":""}" data-rx="1">RX</button><button type="button" class="sc ${rx?"":"on"}" data-rx="0">Scaled</button></div>`:""}
    <label class="f">הערה (לא חובה)<input type="text" id="l-note" maxlength="120" value="${esc(ex?.note||"")}" placeholder="למשל: 30 ק״ג, ring rows"></label>
    <div class="err" id="l-err"></div>
    <div class="rowbtns"><button class="btn primary" type="submit" style="flex:1">שמירה</button>${ex?'<button class="btn ghost danger" type="button" id="l-del">מחיקה</button>':""}<button class="btn ghost" type="button" id="l-cancel">ביטול</button></div></form></div>`;
  const form=document.getElementById("logform");let isRx=rx;const errEl=form.querySelector("#l-err");
  form.querySelector("#l-a")?.focus();
  if(form.querySelector("#l-rx"))form.querySelector("#l-rx").onclick=e=>{const b=e.target.closest("[data-rx]");if(!b)return;isRx=b.dataset.rx==="1";form.querySelectorAll("#l-rx button").forEach(x=>x.classList.toggle("on",x===b))};
  const close=()=>document.getElementById("sheet-root").innerHTML="";
  document.getElementById("scrim").onclick=e=>{if(e.target.id==="scrim")close()};
  form.querySelector("#l-cancel").onclick=close;
  const del=form.querySelector("#l-del");
  if(del)del.onclick=async()=>{const next={...(S.results[S.uid]||{})};delete next[key];try{await saveMine(next);close();toast("התוצאה נמחקה")}catch(err){errEl.textContent=errMsg(err)}};
  form.onsubmit=async e=>{e.preventDefault();unlockAudio();
    const a=parseFloat(form.querySelector("#l-a")?.value);const bEl=form.querySelector("#l-b");const b=bEl?parseFloat(bEl.value||"0"):0;let value=null;
    if(p.type==="time"){if(b>59){errEl.textContent="שניות צריכות להיות בין 0 ל-59.";return}if(!isNaN(a)||b)value=(isNaN(a)?0:a)*60+(b||0)}
    else if(p.type==="rounds")value=isNaN(a)?null:a*1000+(b||0);
    else value=isNaN(a)?null:a;
    if(value==null||value<=0){errEl.textContent="צריך להזין תוצאה לפני השמירה.";return}
    const weight=isWeightPart(p)&&p.type==="load";const lift=weight?(p.lift||detectLift(p.name+"\n"+p.description)||p.name):"";
    const entry={wod:S.date,part:p.id,partName:p.name,type:p.type,value,rx:usesRx(p)?isRx:true,note:form.querySelector("#l-note").value.trim(),ts:new Date().toISOString(),cat:p.category||"",lift,rm:p.type==="load"?rmOf(p):0};
    const prev=weight?bestWorking(S.uid,lift,key):null;
    const rmN=p.type==="load"?rmOf(p):0;const rmLift=lift||detectLift(p.name+"\n"+p.description)||p.name;
    const prevRM=rmN?rmRecords(S.uid).filter(r=>r.key!==key&&r.reps===rmN&&normName(r.lift)===normName(rmLift)).reduce((b,r)=>!b||r.value>b.value?r:b,null):null;
    const prevB=weight?null:prevBench(S.uid,entry,key);
    const btn=form.querySelector("[type=submit]");btn.disabled=true;
    try{await saveMine({...(S.results[S.uid]||{}),[key]:entry});close();
      const isPR=weight&&prev&&value>prev.value;const isRMPR=rmN&&(!prevRM||value>prevRM.value);const realRMPR=rmN&&prevRM&&value>prevRM.value;
      const isBenchPR=!weight&&prevB&&better(p.type,value,prevB.value);
      chime(isPR||realRMPR||isBenchPR?"pr":"save");
      if(realRMPR)celebrate({title:`${rmN}RM חדש!`,lift:rmLift,value:fmt("load",value),prevText:`הקודם: ${fmt("load",prevRM.value)}`,key});
      else if(isPR)celebrate({title:"שיא אישי חדש!",lift,value:fmt("load",value),prevText:`הקודם: ${fmt("load",prev.value)}`,key});
      else if(isBenchPR)celebrate({title:"שיא אישי חדש!",lift:p.name+(usesRx(p)?(isRx?" · RX":" · Scaled"):""),value:fmt(p.type,value),prevText:`הקודם: ${fmt(p.type,prevB.value)} · ${heDate(prevB.wod,{day:"numeric",month:"short",year:"2-digit"})}`,key});
      else if(rmN&&isRMPR)toast(`💾 נשמר כ-${rmN}RM ב-${rmLift}: ${fmt("load",value)}`);
      else if(weight&&!prev)toast(`נשמר. זה השיא הראשון שלך ב-${lift}`);
      else toast("התוצאה נשמרה 💪")}catch(err){btn.disabled=false;errEl.textContent=errMsg(err)}
  };
}
function openRM(prefLift){
  const known=[...new Set([...LIFTS,...rmRecords(S.uid).map(r=>r.lift)])];
  document.getElementById("sheet-root").innerHTML=`<div class="scrim" id="scrim"><form class="sheet" id="rmform" novalidate dir="rtl" role="dialog" aria-label="הוספת RM">
    <h3>הוספת מקסימום (RM)</h3><div class="sub">נשמר בהיסטוריה שלכם, ומשמש לחישוב משקלים לפי אחוזים.</div>
    <label class="f">תרגיל<select id="rm-lift" dir="ltr">${liftOptions(prefLift?(known.find(k=>normName(k)===normName(prefLift))||prefLift):"",rmRecords(S.uid).map(r=>r.lift))}</select></label>
    <input type="text" id="rm-other" dir="ltr" placeholder="שם התרגיל (באנגלית)" hidden>
    <div class="seg seg4" id="rm-reps">${RM_REPS.map(n=>`<button type="button" class="rx ${n===1?"on":""}" data-reps="${n}">${n}RM</button>`).join("")}</div>
    <div class="nums"><label class="f">משקל (ק״ג)<input type="number" inputmode="decimal" min="0" step="0.5" id="rm-val"></label></div>
    <label class="f">תאריך<input type="date" id="rm-date" value="${todayKey()}"></label>
    <div class="err" id="rm-err"></div>
    <div class="rowbtns"><button class="btn primary" type="submit" style="flex:1">שמירה</button><button class="btn ghost" type="button" id="rm-cancel">ביטול</button></div></form></div>`;
  const f=document.getElementById("rmform");let reps=1;const errEl=f.querySelector("#rm-err");
  if(prefLift)f.querySelector("#rm-val").focus();
  const sel=f.querySelector("#rm-lift"),other=f.querySelector("#rm-other");
  sel.onchange=()=>{other.hidden=sel.value!=="__other";if(!other.hidden)other.focus()};
  f.querySelector("#rm-reps").onclick=e=>{const b=e.target.closest("[data-reps]");if(!b)return;reps=+b.dataset.reps;f.querySelectorAll("#rm-reps button").forEach(x=>x.classList.toggle("on",x===b))};
  const close=()=>document.getElementById("sheet-root").innerHTML="";
  document.getElementById("scrim").onclick=e=>{if(e.target.id==="scrim")close()};f.querySelector("#rm-cancel").onclick=close;
  f.onsubmit=async e=>{e.preventDefault();unlockAudio();
    let lift=(sel.value==="__other"?other.value:sel.value).trim();const val=parseFloat(f.querySelector("#rm-val").value);const date=f.querySelector("#rm-date").value||todayKey();
    if(!lift){errEl.textContent="צריך לבחור תרגיל.";return}
    lift=known.find(k=>normName(k)===normName(lift))||detectLift(lift)||lift;
    if(!(val>0)){errEl.textContent="צריך להזין משקל.";return}
    const prev=bestRM(S.uid,lift,reps);const id="rm"+Date.now().toString(36);
    const btn=f.querySelector("[type=submit]");btn.disabled=true;
    try{await saveMine(null,{...(S.rms[S.uid]||{}),[id]:{lift,reps,value:val,date,ts:new Date().toISOString()}});close();
      chime(prev&&val>prev.value?"pr":"save");toast(prev&&val>prev.value?`🏆 ${reps}RM חדש ב-${lift}! ${fmt("load",val)}`:`${reps}RM נשמר: ${lift} ${fmt("load",val)}`)}
    catch(err){btn.disabled=false;errEl.textContent=errMsg(err)}};
}
function errMsg(err){
  if(err?.message==="busy")return "שמירה קודמת עדיין בתהליך. נסו שוב בעוד רגע.";
  if(err?.code==="permission-denied")return "אין לך הרשאה לשמור. בדקו שהמייל שלכם רשום אצל המאמן.";
  return "השמירה לא הצליחה. בדקו את החיבור ונסו שוב.";
}

/* ---------- events ---------- */
document.addEventListener("click",async e=>{
  const t=e.target.closest("button");if(!t)return;
  if(timerClick(t))return;
  if(t.id==="logout"){await signOut(auth);return}
  if(t.dataset.share){openShare(t.dataset.share,!!t.dataset.sharepr);return}
  if(t.dataset.toggletheme){toggleTheme();t.textContent=isDark()?"☀️ מעבר לתצוגה בהירה":"🌙 מעבר לתצוגה כהה";return}
  if(t.dataset.tmode){TCFG={mode:t.dataset.tmode,...TDEF[t.dataset.tmode]};try{localStorage.setItem("savoyTimer",JSON.stringify(TCFG))}catch{}render();return}
  if(t.dataset.tstart){syncTimerForm();startTimer(TCFG,null);return}
  if(t.dataset.timerpart){const p=S.wods[S.date]?.parts?.find(x=>x.id===t.dataset.timerpart);const c=timerFor(p);if(c){TCFG={...TDEF[c.mode],...c};startTimer(TCFG,{date:S.date,part:p.id})}return}
  if(t.id==="bell"){openLikes();return}
  if(t.dataset.enablepush){enablePush();return}
  if(t.dataset.togglesound){try{localStorage.setItem("savoySound",soundOn()?"off":"on")}catch{}t.textContent=soundOn()?"🔊 צלילים: פועל":"🔇 צלילים: כבוי";if(soundOn())chime();return}
  if(t.dataset.like){toggleLike(t.dataset.like,t.dataset.lpart);return}
  if(t.dataset.tab){S.tab=t.dataset.tab;if(S.tab==="coach")S.draft=null;render();window.scrollTo(0,0);return}
  if(t.dataset.date){S.date=t.dataset.date;render();return}
  if(t.dataset.week){S.date=addDays(S.date,+t.dataset.week);render();return}
  if(t.dataset.goto){S.date=t.dataset.goto;S.tab="wod";render();window.scrollTo(0,0);return}
  if(t.dataset.editwod){S.tab="coach";S.draft=null;render(true);window.scrollTo(0,0);return}
  if(t.dataset.gender){S.gender=t.dataset.gender;render();return}
  if(t.dataset.mode){S.mode=t.dataset.mode;render();return}
  if(t.dataset.filter){S.filter[t.dataset.filter]=t.dataset.f;render();return}
  if(t.dataset.log){openLog(t.dataset.log);return}
  if(t.dataset.addrm!==undefined){openRM(t.dataset.addrm);return}
  if(t.dataset.delrm){if(t.dataset.confirm!=="1"){t.dataset.confirm="1";t.textContent="למחוק?";return}const next={...(S.rms[S.uid]||{})};delete next[t.dataset.delrm];try{await saveMine(null,next);toast("נמחק")}catch(err){toast(errMsg(err))}return}
  if(S.tab==="coach")coachClick(t);
});
function syncWeek(){const w=S.week;if(!w)return;const a=document.getElementById("w-start"),b=document.getElementById("w-text");if(a)w.start=a.value||w.start;if(b)w.text=b.value;document.querySelectorAll("[data-wday]").forEach(c=>{const d=w.days?.[+c.dataset.wday];if(d)d.include=c.checked})}
function syncDraft(){
  const d=S.draft;if(!d)return;
  const g=id=>document.getElementById(id);
  if(g("c-date"))d.date=g("c-date").value||d.date;
  if(g("c-text"))d.text=g("c-text").value;
  if(g("c-title"))d.title=g("c-title").value;
  if(g("c-members"))d.members=g("c-members").value;
  document.querySelectorAll(".pedit").forEach(el=>{const p=d.parts[+el.dataset.i];if(!p)return;el.querySelectorAll("[data-k]").forEach(i=>p[i.dataset.k]=i.value)});
}
document.addEventListener("change",e=>{
  if(S.tab==="timer"&&/^t-/.test(e.target.id||"")){syncTimerForm();render();return}
  if(e.target.dataset.wday!==undefined){syncWeek();render(true);return}
  if(e.target.id==="w-start"&&S.week){syncWeek();S.week.days=null;render(true);return}
  if(e.target.dataset.liftsel!==undefined&&e.target.value==="__other"&&S.draft){syncDraft();const p=S.draft.parts[+e.target.dataset.liftsel];if(p){p.lift="";p.liftOther=true}render(true);document.querySelector(`.pedit[data-i="${e.target.dataset.liftsel}"] [data-k=lift]`)?.focus();return}
  if(e.target.id==="c-date"){syncDraft();const ex=S.wods[S.draft.date];if(ex){S.draft.title=ex.title||"";S.draft.parts=JSON.parse(JSON.stringify(ex.parts));S.draft.text=""}render(true);toast(ex?"נטען האימון הקיים של היום הזה":"אין עדיין אימון ליום הזה")}
});
async function coachClick(t){
  syncDraft();syncWeek();
  if(t.id==="w-split"){const w=S.week;w.days=splitWeek(w.text,w.start).map(d=>{const r=parseWod(d.text);const old=S.wods[d.date]?.parts||[];r.parts.forEach(np=>{const m=old.find(o=>(o.label||"").toUpperCase()===(np.label||"").toUpperCase());if(m)np.id=m.id});return {...d,title:r.title,parts:r.parts,include:r.parts.length>0}}).filter(d=>d.parts.length);render(true);if(w.days.length)toast(`זוהו ${w.days.length} ימים`);return}
  if(t.id==="w-publish"){const w=S.week;const todo=(w.days||[]).filter(d=>d.include);if(!todo.length){toast("לא נבחרו ימים");return}
    t.disabled=true;let done=0;
    try{for(const d of todo){await setDoc(doc(db,"wods",d.date),{date:d.date,title:d.title||"",source:"week-paste",parts:d.parts.map(p=>({id:p.id,label:p.label,name:p.name,category:p.category||"",lift:p.lift||"",type:p.type,description:p.description})),updated:new Date().toISOString()});done++}
      S.week={start:w.start,text:"",days:null};S.date=todo[0].date;S.tab="wod";render(true);window.scrollTo(0,0);toast(`פורסמו ${done} ימים 💪`)}
    catch{t.disabled=false;const e=document.getElementById("w-err");if(e)e.textContent=`הפרסום נעצר אחרי ${done} ימים. בדקו את החיבור ונסו שוב.`}
    return}const d=S.draft;const err=()=>document.getElementById("c-err");
  if(t.id==="c-parse"){const r=parseWod(d.text);if(!r.parts.length){toast("לא נמצא טקסט לפירוק");return}const old=S.wods[d.date]?.parts||[];r.parts.forEach(np=>{const m=old.find(o=>(o.label||"").toUpperCase()===(np.label||"").toUpperCase());if(m)np.id=m.id});d.parts=r.parts;d.confirmRemove=false;if(r.title)d.title=r.title;render(true);toast(`זוהו ${r.parts.length} חלקים`);return}
  if(t.id==="c-addpart"){d.parts.push({id:"p"+Date.now().toString(36),label:String.fromCharCode(65+d.parts.length),name:"",category:"",lift:"",type:"reps",description:""});render(true);return}
  if(t.dataset.rmpart!=null){d.parts.splice(+t.dataset.rmpart,1);render(true);return}
  if(t.dataset.cat){const p=d.parts[+t.dataset.ci];if(!p)return;const c=t.dataset.cat;p.category=p.category===c?"":c;
    if(!p.name.trim()||CATS.includes(p.name.trim())||/^חלק \d+$|^אימון$/.test(p.name.trim()))p.name=p.category||p.name;
    p.type=guessType(p.category,p.name,p.description);p.lift=WEIGHT_CATS.has(p.category)?(p.lift||detectLift(p.name+"\n"+p.description)):"";render(true);return}
  if(t.id==="c-save"){
    const lost=removedWithResults(d);
    if(lost.length&&!d.confirmRemove){d.confirmRemove=true;err().textContent=`שימו לב: ${lost.map(x=>`"${x.o.name}" (${x.n} תוצאות)`).join(", ")} הוסרו מהאימון, והתוצאות שלהם לא יופיעו בלוח. לחצו שוב על השמירה כדי לאשר.`;return}
    if(d.parts.some(p=>!p.name.trim())){err().textContent="לכל חלק צריך שם.";return}
    const ids=new Set();d.parts.forEach((p,i)=>{if(!p.id||ids.has(p.id))p.id=(p.label||"p").toLowerCase()+i+Date.now().toString(36).slice(-3);ids.add(p.id)});
    t.disabled=true;
    try{await setDoc(doc(db,"wods",d.date),{date:d.date,title:d.title.trim(),parts:d.parts.map(p=>({id:p.id,label:p.label.trim(),name:p.name.trim(),category:p.category||"",lift:WEIGHT_CATS.has(p.category)&&p.lift!=="__other"?(p.lift||"").trim():"",type:p.type,description:p.description})),updated:new Date().toISOString()});
      S.date=d.date;S.tab="wod";S.draft=null;render(true);window.scrollTo(0,0);toast("האימון פורסם")}
    catch{t.disabled=false;err().textContent="הפרסום לא הצליח. בדקו את החיבור ונסו שוב."}
    return}
  if(t.id==="c-del"){
    if(t.dataset.confirm!=="1"){t.dataset.confirm="1";t.textContent="ללחוץ שוב כדי למחוק";return}
    try{await deleteDoc(doc(db,"wods",d.date));S.draft=null;render(true);toast("האימון נמחק")}catch{err().textContent="המחיקה לא הצליחה."}
    return}
  if(t.id==="c-addmembers"){
    const list=[...new Set(d.members.split(/[\s,;]+/).map(x=>x.trim().toLowerCase()).filter(x=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))];
    if(!list.length){toast("לא נמצאו כתובות מייל תקינות");return}
    t.disabled=true;
    for(const m of list)await setDoc(doc(db,"members",m),{added:new Date().toISOString(),source:"manual"});
    d.members="";render(true);toast(`נוספו ${list.length} מתאמנים`);return}
  if(t.dataset.rmmember){await deleteDoc(doc(db,"members",t.dataset.rmmember));toast("הוסר");return}
}

/* ---------- auth + boot ---------- */
const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:"select_account"});
const isStandalone=window.matchMedia("(display-mode: standalone)").matches||navigator.standalone;
document.getElementById("google-btn").onclick=async()=>{
  // Popup flow only: redirect sign-in loses its state on iPhone and in home-screen apps (storage partitioning).
  try{await signInWithPopup(auth,provider)}
  catch(e){
    if(e?.code==="auth/popup-closed-by-user"||e?.code==="auth/cancelled-popup-request")return;
    if(e?.code==="auth/popup-blocked")showLogin("הטלפון חסם את חלון הכניסה. לחצו שוב על \"כניסה עם Google\", או היכנסו עם קישור למייל.");
    else showLogin("הכניסה עם Google לא הצליחה. נסו שוב, או היכנסו עם קישור למייל.");}
};
document.getElementById("switch-btn").onclick=()=>signOut(auth);
getRedirectResult(auth).catch(()=>{});
document.getElementById("email-toggle").onclick=()=>{document.getElementById("email-form").hidden=false;document.getElementById("email-toggle").hidden=true;document.getElementById("email-input").focus()};
document.getElementById("email-form").onsubmit=async e=>{
  e.preventDefault();const em=document.getElementById("email-input").value.trim().toLowerCase();const msg=document.getElementById("email-msg");
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)){msg.textContent="צריך להזין כתובת מייל תקינה.";return}
  const btn=e.target.querySelector("button");btn.disabled=true;
  try{await sendSignInLinkToEmail(auth,em,{url:location.origin+location.pathname,handleCodeInApp:true});
    try{localStorage.setItem("savoyEmail",em)}catch{}
    msg.textContent=`שלחנו קישור כניסה ל-${em}. פתחו את המייל באותו מכשיר ולחצו על הקישור. אם הוא לא מגיע תוך דקה, בדקו בספאם.`}
  catch(err){btn.disabled=false;msg.textContent=err?.code==="auth/quota-exceeded"?"הגענו למכסת המיילים היומית. נסו שוב מחר או היכנסו עם Google.":"שליחת הקישור לא הצליחה. בדקו את הכתובת ונסו שוב."}
};
if(isSignInWithEmailLink(auth,location.href)){
  let em=null;try{em=localStorage.getItem("savoyEmail")}catch{}
  if(em){signInWithEmailLink(auth,em,location.href).then(()=>{try{localStorage.removeItem("savoyEmail")}catch{};history.replaceState(null,"",location.pathname)}).catch(()=>showLogin("קישור הכניסה פג תוקף או כבר נוצל. בקשו קישור חדש."))}
  else{document.getElementById("email-form").hidden=false;document.getElementById("email-toggle").hidden=true;document.getElementById("email-msg").textContent="הזינו שוב את המייל כדי להשלים את הכניסה.";
    document.getElementById("email-form").onsubmit=async e=>{e.preventDefault();const v=document.getElementById("email-input").value.trim().toLowerCase();
      try{await signInWithEmailLink(auth,v,location.href);history.replaceState(null,"",location.pathname)}catch{document.getElementById("email-msg").textContent="הכניסה לא הצליחה. ודאו שזה המייל שאליו נשלח הקישור."}}}
}

function showLogin(msg,canSwitch=false){
  document.getElementById("boot")?.remove();
  document.getElementById("app").hidden=true;document.getElementById("login").hidden=false;
  if(msg)document.getElementById("login-msg").textContent=msg;
  document.getElementById("switch-btn").hidden=!canSwitch;document.getElementById("google-btn").hidden=canSwitch;
}
function stopListeners(){S.unsubs.forEach(u=>u());S.unsubs=[];if(S.likesUnsub)S.likesUnsub();S.likesUnsub=null;S.likesDate=null;S.likesDay={};S.likesMine=[]}

onAuthStateChanged(auth,async user=>{
  stopListeners();
  if(!user){Object.assign(S,{uid:null,email:null,isCoach:false,ready:false,wods:{},results:{},rms:{},users:{},members:[]});showLogin("אפליקציית התוצאות של CrossFit Savoy. נכנסים עם Google, או עם המייל שרשום ב-Arbox.");return}
  S.uid=user.uid;S.email=(user.email||"").toLowerCase();
  // Access check: use the answer remembered from the last visit to open instantly, verify in the background.
  const accKey="savoyAccess:"+S.uid;let cached=null;try{cached=JSON.parse(localStorage.getItem(accKey)||"null")}catch{}
  const verify=Promise.all([getDoc(doc(db,"coaches",S.email)).then(d=>d.exists()).catch(()=>null),getDoc(doc(db,"members",S.email)).then(d=>({ok:d.exists(),gender:d.data()?.gender||""})).catch(()=>null)])
    .then(([c,m])=>{if(c===null&&m===null)return null;const r={coach:!!c,member:!!m?.ok,gender:m?.gender||""};try{localStorage.setItem(accKey,JSON.stringify(r))}catch{}return r});
  let acc=cached&&(cached.coach||cached.member)?cached:await verify;
  if(acc===cached)verify.then(r=>{if(!r)return;if(!r.coach&&!r.member){try{localStorage.removeItem(accKey)}catch{};stopListeners();showLogin(`החשבון ${S.email} כבר לא רשום כמתאמן פעיל ב-Savoy.`,true);return}if(r.coach!==S.isCoach){S.isCoach=r.coach;render()}});
  const coach=!!acc?.coach,member=!!acc?.member,gender=acc?.gender||"";
  if(!coach&&!member){showLogin(`החשבון ${S.email} עוד לא רשום כמתאמן ב-Savoy. אם נרשמתם לאחרונה, הגישה תיפתח תוך שעה. אפשר גם להיכנס עם המייל שרשום ב-Arbox.`,true);return}
  S.isCoach=coach;
  setDoc(doc(db,"users",S.uid),{name:user.displayName||S.email.split("@")[0],photo:user.photoURL||"",gender:["male","female"].includes(gender)?gender:"",lastSeen:new Date().toISOString()},{merge:true}).catch(()=>{});
  document.getElementById("login").hidden=true;document.getElementById("app").hidden=false;document.getElementById("boot")?.remove();
  render();
  let gotW=false,gotR=false;const done=()=>{if(gotW&&gotR&&!S.ready){S.ready=true}};
  S.unsubs.push(onSnapshot(collection(db,"wods"),snap=>{const w={};snap.forEach(d=>{const x=d.data();if(Array.isArray(x.parts))w[d.id]=x});S.wods=w;gotW=true;done();if(S.tab!=="coach"&&S.tab!=="timer")render();else renderTabs()}));
  S.unsubs.push(onSnapshot(collection(db,"results"),snap=>{const r={},m={};snap.forEach(d=>{const x=d.data();r[d.id]=x.entries||{};m[d.id]=x.rms||{}});S.results=r;S.rms=m;gotR=true;done();if(S.tab!=="coach"&&S.tab!=="timer")render()}));
  S.unsubs.push(onSnapshot(collection(db,"users"),snap=>{const u={};snap.forEach(d=>u[d.id]=d.data());S.users=u;if(S.tab!=="coach"&&S.tab!=="timer")render();else renderWho()}));
  if(pushState()==="granted")setTimeout(()=>registerPush(true),2500);
  let firstLikes=true;
  S.unsubs.push(onSnapshot(query(collection(db,"likes"),where("owner","==",S.uid)),snap=>{
    const list=[];snap.forEach(x=>list.push(x.data()));
    if(!firstLikes){const prev=new Set(S.likesMine.map(l=>l.by+l.wod+l.part));const fresh=list.filter(l=>l.by!==S.uid&&!prev.has(l.by+l.wod+l.part));if(fresh.length)toast("❤️ "+likeText(fresh[fresh.length-1]))}
    firstLikes=false;S.likesMine=list;renderWho()},()=>{}));
  if(coach)S.unsubs.push(onSnapshot(doc(db,"meta","import"),snap=>{S.importStatus=snap.exists()?snap.data():null;if(S.tab==="wod"||S.tab==="coach")render(S.tab==="coach")},()=>{}));
  if(coach)S.unsubs.push(onSnapshot(collection(db,"members"),snap=>{S.members=snap.docs.map(d=>d.id).sort();if(S.tab==="coach")render()}));
});

if(navigator.serviceWorker)navigator.serviceWorker.register("sw.js").catch(()=>{});
