// Workout text parsing shared by the app and the Arbox import job.
const CATS=["Strength","Weightlifting","Accessories","Metcon","Skill","Gymnastics"];
const WEIGHT_CATS=new Set(["Strength","Weightlifting"]);
const LIFTS=["Back Squat","Front Squat","Overhead Squat","Deadlift","Sumo Deadlift","Romanian Deadlift","Bench Press","Strict Press","Push Press","Push Jerk","Split Jerk","Clean & Jerk","Squat Clean","Power Clean","Hang Power Clean","Hang Clean","Clean","Squat Snatch","Power Snatch","Hang Power Snatch","Hang Snatch","Snatch","Jerk","Thruster","Weighted Pull-up"];
const OLY=/clean|snatch|jerk/i;
const RM_REPS=[1,2,3,5];
const LIFT_RE=LIFTS.slice().sort((a,b)=>b.length-a.length).map(n=>[n,new RegExp("(^|[^a-z])"+n.toLowerCase().replace(/&/g,"(?:&|and|n)").replace(/[-\s]+/g,"[\\s-]*")+"(?:e?s)?(?![a-z])","i")]);
const LIFT_ALIASES=[[/(^|[^a-z])c\s*&\s*j(?![a-z])/i,"Clean & Jerk"],[/(^|[^a-z])ohs(?![a-z])/i,"Overhead Squat"],[/(^|[^a-z])rdl(?![a-z])/i,"Romanian Deadlift"]];
function detectLift(text){const t=String(text||"");for(const [n,re] of LIFT_RE)if(re.test(t))return n;for(const [re,n] of LIFT_ALIASES)if(re.test(t))return n;return ""}
// Rep-max part? "3RM", "2 rep max", "build to a heavy double", "heavy single", "max triple", "heavy 5" -> number of reps
function rmOf(p){
  const t=String((p.name||"")+" "+(p.description||"")).toLowerCase();
  let m=t.match(/(?:^|[^0-9])(10|[1-9])\s*-?\s*(?:rm|rep\s*max|reps?\s*max)\b/);if(m)return +m[1];
  const W={single:1,double:2,triple:3,quad:4,quadruple:4};
  m=t.match(/\b(?:heavy|heaviest|max|maximal|top)\s+(single|double|triple|quadruple|quad)\b/)||t.match(/\bbuild(?:ing)?\s+(?:up\s+)?to\s+(?:a|your)?\s*(?:heavy\s+|max\s+)?(single|double|triple)\b/);
  if(m)return W[m[1]];
  m=t.match(/\b(?:heavy|heaviest|max)\s+(2|3|4|5|6|8|10)(?![\s-]*(?:min|minutes|kg|lb|%|x|×|sets?|rounds?|cal|m\b|reps?\s+of))\b/);if(m)return +m[1];
  return 0;
}

const HEAD_RE=/^\s*(?:(?:part|חלק)\s*([A-Za-zא-ת0-9]+)|([A-H])\s*[\.\):\-–]|(warm[\s-]?up|strength|skill|metcon|wod|conditioning|accessory|accessories|cool[\s-]?down|finisher|gymnastics|olympic|weightlifting|חימום|כוח|טכניקה|מטקון|סקיל|אביזרים|שחרור|מתיחות|אימון))(?=$|[\s:.\-–)])[\s:.\-–)]*(.*)$/i;
const CAT_KW=[[/strength|כוח/i,"Strength"],[/weightlifting|olympic|הרמת משקולות/i,"Weightlifting"],[/accessor|אביזרים/i,"Accessories"],[/metcon|wod|conditioning|מטקון|finisher/i,"Metcon"],[/skill|סקיל|טכניקה/i,"Skill"],[/gymnastics|התעמלות/i,"Gymnastics"]];
function guessCategory(name,text){
  const n=String(name||"");if(/warm|cool|חימום|שחרור|מתיחות/i.test(n))return "";
  for(const [re,c] of CAT_KW)if(re.test(n))return c;
  const t=n+"\n"+(text||"");const lift=detectLift(t);
  if(lift&&/%|\d\s*[x×]\s*\d|\d+(-\d+){2,}|\d\s*rm|sets?|build|heavy|emom/i.test(t)&&!/amrap|for\s*time|rft/i.test(t))return OLY.test(lift)?"Weightlifting":"Strength";
  if(/amrap|for\s*time|rft|rounds|emom|chipper|tabata|לזמן/i.test(t))return "Metcon";
  return "";
}
function guessType(cat,name,text){
  const n=String(name||""),t=(n+" "+(text||"")).toLowerCase();
  if(/warm|cool|חימום|שחרור|מתיחות/i.test(n))return "none";
  if(WEIGHT_CATS.has(cat))return "load";
  if(/for\s*(weight|load)|max\s*load/.test(t))return "load";
  if(/amrap/.test(t))return "reps";
  if(/for\s*time|rft|rounds\s*for\s*time|לזמן/.test(t))return "time";
  if(cat==="Metcon")return "reps";
  if(cat==="Accessories"||cat==="Skill"||cat==="Gymnastics")return /max\s*(reps|unbroken|ub)/.test(t)?"reps":"none";
  if(/\b\d?rm\b|heavy|build to|\d+\s*%|\d+\s*[x×]\s*\d+|\d+(-\d+){2,}/.test(t))return "load";
  return "reps";
}
function enrichPart(p){const cat=p.category??guessCategory(p.name,p.description);const lift=WEIGHT_CATS.has(cat)?(p.lift||detectLift(p.name+"\n"+p.description)):"";return {...p,category:cat,lift,type:guessType(cat,p.name,p.description)}}
function parseWod(text){
  const lines=String(text||"").replace(/\r/g,"").split("\n");
  const parts=[];let cur=null;const pre=[];
  for(const raw of lines){
    const line=raw.replace(/\s+$/,"");
    const m=line.match(HEAD_RE);
    if(m){
      const letter=(m[1]||m[2]||"").toUpperCase();const kw=m[3]||"";const rest=(m[4]||"").trim();
      const long=kw&&rest.length>40;
      cur={label:letter,name:(rest&&!long?rest:(kw?kw.replace(/^\w/,c=>c.toUpperCase()):"")),kw,body:long?[rest]:[]};
      if(!cur.name)cur.name="חלק "+(parts.length+1);
      parts.push(cur);
    }else if(cur)cur.body.push(line);
    else if(line.trim())pre.push(line.trim());
  }
  if(!parts.length)return {title:"",parts:pre.length?[enrichPart({id:"a0",label:"A",name:"אימון",description:pre.join("\n")})]:[]};
  return {title:pre.join(" · "),parts:parts.map((p,i)=>{
    const desc=p.body.join("\n").replace(/^\n+|\n+$/g,"");const label=p.label||String.fromCharCode(65+i);
    const kwCat=p.kw?guessCategory(p.kw,""):null;
    const e=enrichPart({id:label.toLowerCase()+i,label,name:p.name,description:desc,...(p.kw?{category:kwCat}:{})});
    if(e.category&&/^(strength|weightlifting|accessories|accessory|metcon|wod|conditioning|skill|gymnastics|olympic|כוח|מטקון|אביזרים|טכניקה|סקיל)$/i.test(e.name.trim()))e.name=e.category;
    return e;
  })};
}

// ---- weekly paste: split a whole week of workouts into days ----------------------------------
const HE_DAYS=[["ראשון","א"],["שני","ב"],["שלישי","ג"],["רביעי","ד"],["חמישי","ה"],["שישי","ו"],["שבת","ש"]];
const EN_DAYS=["sun","mon","tue","wed","thu","fri","sat"];
function dayIndexOf(line){
  const t=line.trim().toLowerCase().replace(/[׳'"`]/g,"");
  for(let i=0;i<7;i++){const [full,letter]=HE_DAYS[i];
    if(new RegExp("^(?:יום\\s+)?"+full+"(?=$|[\\s,.:\\-–(0-9])").test(t))return i;
    if(new RegExp("^יום\\s+"+letter+"(?=$|[\\s,.:\\-–(0-9])").test(t))return i;}
  const m=t.match(/^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?(?=$|[\s,.:\-–(0-9])/);if(m)return EN_DAYS.indexOf(m[1]);
  return -1;
}
function dateIn(line,refYear){
  const m=line.match(/(?:^|[^\d])(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/);if(m)return [+m[1],+m[2],+m[3]];
  const n=line.match(/(?:^|[^\d:])(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?![\d:])/);
  if(n){const d=+n[1],mo=+n[2];if(d<1||d>31||mo<1||mo>12)return null;let y=n[3]?+n[3]:refYear;if(y<100)y+=2000;return [y,mo,d]}
  return null;
}
const pad=n=>String(n).padStart(2,"0");
const keyOf=(y,m,d)=>`${y}-${pad(m)}-${pad(d)}`;
function addDaysKey(k,n){const [y,m,d]=k.split("-").map(Number);const dt=new Date(Date.UTC(y,m-1,d+n));return keyOf(dt.getUTCFullYear(),dt.getUTCMonth()+1,dt.getUTCDate())}
function isDayHeader(line){
  const t=line.trim();if(!t||t.length>40)return false;
  if(dayIndexOf(t)>=0)return true;
  // a line that is only a date (optionally with a weekday word)
  return /^[\s(]*(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)[\s)]*$/.test(t);
}
// weekStart: "YYYY-MM-DD" of the Sunday of the week being imported
function splitWeek(text,weekStart){
  const lines=String(text||"").replace(/\r/g,"").split("\n");const refYear=+weekStart.slice(0,4);
  const days=[];let cur=null;
  for(const line of lines){
    if(isDayHeader(line)){
      const dt=dateIn(line,refYear);const idx=dayIndexOf(line);
      const date=dt?keyOf(...dt):(idx>=0?addDaysKey(weekStart,idx):null);
      if(date){cur={date,header:line.trim(),lines:[]};days.push(cur);continue}
    }
    if(cur)cur.lines.push(line);
  }
  const byDate=new Map();
  for(const d of days){const body=d.lines.join("\n").replace(/^\s+|\s+$/g,"");if(!body)continue;
    if(byDate.has(d.date))byDate.get(d.date).text+="\n"+body;else byDate.set(d.date,{date:d.date,header:d.header,text:body})}
  return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
}

export {splitWeek,CATS,WEIGHT_CATS,LIFTS,OLY,RM_REPS,detectLift,rmOf,guessCategory,guessType,enrichPart,parseWod};
