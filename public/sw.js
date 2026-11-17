// Service worker: instant start from cache, installable app, and push notifications.
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js","https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
firebase.initializeApp({apiKey:"AIzaSyBvoE1JUrWUvjdsn1NlmvMdtnQRTbeB34M",authDomain:"savoy-wod.firebaseapp.com",projectId:"savoy-wod",storageBucket:"savoy-wod.firebasestorage.app",messagingSenderId:"344911784472",appId:"1:344911784472:web:2a9bdbcaf245110905716d"});
try{firebase.messaging()}catch(e){}

const CACHE="savoy-v5";
const SHELL=["./","index.html","styles.css","app.js","parser.js","firebase-config.js","logo.png","emblem.png","manifest.webmanifest","icons/icon-192.png"];
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).catch(()=>{}))});
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));

// App files: answer from cache right away, refresh the cache in the background (new version shows on the next open).
// Versioned Firebase SDK files and fonts: cache first. Everything else (database, sign-in): straight to the network.
self.addEventListener("fetch",e=>{
  const req=e.request;if(req.method!=="GET")return;
  const url=new URL(req.url);
  const sameOrigin=url.origin===self.location.origin;
  if(sameOrigin&&url.pathname.startsWith("/setup/"))return;
  if(sameOrigin&&url.pathname.startsWith("/__/"))return; // Firebase auth helper pages
  const sdk=url.origin==="https://www.gstatic.com"&&url.pathname.startsWith("/firebasejs/");
  const fonts=url.origin==="https://fonts.googleapis.com"||url.origin==="https://fonts.gstatic.com";
  if(!sameOrigin&&!sdk&&!fonts)return;
  if(sdk||url.origin==="https://fonts.gstatic.com"){
    e.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(res=>{if(res.ok||res.type==="opaque"){const cp=res.clone();caches.open(CACHE).then(c=>c.put(req,cp))}return res})));
    return;
  }
  const key=sameOrigin&&req.mode==="navigate"?"index.html":req;
  e.respondWith(caches.open(CACHE).then(c=>c.match(key,{ignoreSearch:sameOrigin&&req.mode==="navigate"}).then(hit=>{
    const net=fetch(req).then(res=>{if(res.ok)c.put(key,res.clone());return res}).catch(()=>hit);
    if(hit){e.waitUntil(net);return hit}
    return net;
  })));
});

self.addEventListener("notificationclick",e=>{
  e.notification.close();
  const url=(e.notification.data&&(e.notification.data.FCM_MSG?.notification?.click_action||e.notification.data.link))||"/";
  e.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(ws=>{for(const w of ws){if("focus" in w)return w.focus()}return clients.openWindow(url)}));
});
