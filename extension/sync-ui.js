const SUPABASE_URL = "https://nusrnzrdfknvcgqccrac.supabase.co";
const SUPABASE_KEY = "sb_publishable_pklir0169Qf5bghO2gO6MQ_eUP4edH4";
const SESSION_KEY = "timepilot-supabase-session";
const state = { syncing: false };

async function getSession() { const x = await chrome.storage.local.get(SESSION_KEY); return x[SESSION_KEY] || null; }
async function setSession(session) { if (session) await chrome.storage.local.set({ [SESSION_KEY]: session }); else await chrome.storage.local.remove(SESSION_KEY); }
function isExpired(session) { return !session?.access_token || (session.expires_at && Date.now() >= (session.expires_at * 1000 - 60000)); }
async function authRequest(path, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, { method:"POST", headers:{ apikey:SUPABASE_KEY, "Content-Type":"application/json" }, body:JSON.stringify(body) });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data?.msg || data?.message || data?.error_description || "Erreur d’authentification");
  return data;
}
async function validSession() {
  let session = await getSession();
  if (!session) return null;
  if (isExpired(session) && session.refresh_token) {
    try { session = await authRequest("token?grant_type=refresh_token", { refresh_token: session.refresh_token }); await setSession(session); }
    catch { await setSession(null); return null; }
  }
  return session;
}
async function rest(path, options={}) {
  const session = await validSession();
  if (!session?.access_token) throw new Error("Connexion requise");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...options, headers:{ apikey:SUPABASE_KEY, Authorization:`Bearer ${session.access_token}`, ...(options.headers||{}) } });
  const text = await res.text(); let data=null; if(text){try{data=JSON.parse(text)}catch{data=text}}
  if(!res.ok) throw new Error(data?.message || data?.hint || `Erreur Supabase (${res.status})`);
  return data;
}
async function getLocalDays() {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all).filter(([k,v]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && v && !v.archived).map(([,v])=>v);
}
async function saveLocalDay(day) { await chrome.storage.local.set({ [day.date]: day }); }
function pauseToRemote(p, dayId, userId, stamp) {
  const duration = Number.isFinite(p?.durationMinutes) ? Math.max(1, Math.round(p.durationMinutes)) : null;
  let source = "timer"; if(duration!==null) source="duration"; else if(p?.manual||p?.range) source="range";
  return { id:p.id, user_id:userId, work_day_id:dayId, source, duration_minutes:duration,
    start_ts:duration===null&&p.startTs?new Date(p.startTs).toISOString():null,
    end_ts:duration===null&&p.endTs?new Date(p.endTs).toISOString():null,
    client_updated_at:stamp, deleted_at:null };
}
function remoteToPause(p) {
  if(p.duration_minutes!=null) return { id:p.id, manual:true, durationMinutes:Number(p.duration_minutes), createdAt:Number(p.client_updated_at||Date.now()) };
  return { id:p.id, startTs:p.start_ts?Date.parse(p.start_ts):null, endTs:p.end_ts?Date.parse(p.end_ts):null,
    manual:p.source==="range"||p.source==="legacy", range:p.source==="range", createdAt:Number(p.client_updated_at||Date.now()) };
}
async function pushDay(local, remoteDay, remotePauses, userId) {
  const stamp=Number(local.updatedAt||Date.now());
  const saved=await rest("work_days?on_conflict=user_id,work_date&select=id,work_date,client_updated_at", { method:"POST", headers:{"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=representation"}, body:JSON.stringify([{user_id:userId,work_date:local.date,arrival_ts:local.arrivalTs?new Date(local.arrivalTs).toISOString():null,client_updated_at:stamp,deleted_at:null}]) });
  const dayId=saved?.[0]?.id||remoteDay?.id; if(!dayId) throw new Error("Impossible de synchroniser la journée");
  const pauses=(local.pauses||[]).filter(p=>p?.id).map(p=>pauseToRemote(p,dayId,userId,stamp));
  if(pauses.length) await rest("work_pauses?on_conflict=id", { method:"POST",headers:{"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(pauses) });
  const ids=new Set(pauses.map(p=>p.id)); for(const old of remotePauses||[]) if(!ids.has(old.id)) await rest(`work_pauses?id=eq.${encodeURIComponent(old.id)}`,{method:"DELETE"});
}
async function syncAll() {
  if(state.syncing||!navigator.onLine) return {changed:false,offline:!navigator.onLine};
  const session=await validSession(); if(!session?.user?.id) return {changed:false,unauthenticated:true}; state.syncing=true;
  try {
    const [localDays,remoteDays,remotePauses]=await Promise.all([getLocalDays(),rest("work_days?select=id,work_date,arrival_ts,client_updated_at&deleted_at=is.null&order=work_date.desc"),rest("work_pauses?select=id,work_day_id,source,duration_minutes,start_ts,end_ts,client_updated_at&deleted_at=is.null")]);
    const localByDate=new Map(localDays.map(d=>[d.date,d])), remoteByDate=new Map((remoteDays||[]).map(d=>[d.work_date,d])), pausesByDay=new Map();
    for(const p of remotePauses||[]){if(!pausesByDay.has(p.work_day_id))pausesByDay.set(p.work_day_id,[]);pausesByDay.get(p.work_day_id).push(p)}
    const dates=new Set([...localByDate.keys(),...remoteByDate.keys()]); let changed=false;
    for(const date of dates){const local=localByDate.get(date),remote=remoteByDate.get(date),ls=Number(local?.updatedAt||0),rs=Number(remote?.client_updated_at||0);
      if(local&&(!remote||ls>=rs)) await pushDay(local,remote,remote?pausesByDay.get(remote.id)||[]:[],session.user.id);
      else if(remote){await saveLocalDay({date,arrivalTs:remote.arrival_ts?Date.parse(remote.arrival_ts):null,pauses:(pausesByDay.get(remote.id)||[]).map(remoteToPause),updatedAt:rs||Date.now(),syncStatus:"synced"});changed=true}
    }
    return {changed,count:dates.size};
  } finally { state.syncing=false; }
}
function injectUI(){
  if(document.getElementById("tpCloudCard"))return;
  const card=document.createElement("section");card.id="tpCloudCard";card.className="card";card.innerHTML=`<div class="row"><div><div class="label">Synchronisation cloud</div><div id="tpCloudStatus" class="big small-big">Non connectée</div><div id="tpCloudDetail" class="hint">Même compte que sur l’iPhone.</div></div><span id="tpCloudDot" class="status-dot"></span></div><div id="tpAuthForm" style="display:grid;gap:6px;margin-top:9px"><input id="tpEmail" type="email" placeholder="Email" style="height:40px;border:1px solid #d7dce2;border-radius:9px;padding:0 9px"><input id="tpPassword" type="password" placeholder="Mot de passe" style="height:40px;border:1px solid #d7dce2;border-radius:9px;padding:0 9px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px"><button id="tpLogin" class="primary">Connexion</button><button id="tpSignup">Créer compte</button></div></div><div id="tpCloudActions" hidden style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:9px"><button id="tpSyncNow" class="primary">Synchroniser</button><button id="tpLogout">Déconnexion</button></div>`;
  document.querySelector(".storage")?.insertAdjacentElement("beforebegin",card);
  const status=document.getElementById("tpCloudStatus"),detail=document.getElementById("tpCloudDetail"),dot=document.getElementById("tpCloudDot"),auth=document.getElementById("tpAuthForm"),actions=document.getElementById("tpCloudActions");
  async function refresh(){const s=await validSession();if(s?.user){status.textContent=navigator.onLine?"Connectée":"Connectée • hors ligne";detail.textContent=s.user.email||"Compte TimePilot";auth.hidden=true;actions.hidden=false;dot.className=`status-dot ${navigator.onLine?"active":"paused"}`}else{status.textContent="Non connectée";detail.textContent="Même compte que sur l’iPhone.";auth.hidden=false;actions.hidden=true;dot.className="status-dot"}}
  document.getElementById("tpLogin").onclick=async()=>{try{status.textContent="Connexion…";const d=await authRequest("token?grant_type=password",{email:document.getElementById("tpEmail").value.trim(),password:document.getElementById("tpPassword").value});await setSession(d);await refresh();const r=await syncAll();if(r.changed)location.reload();else detail.textContent="À jour."}catch(e){status.textContent="Erreur";detail.textContent=e.message}};
  document.getElementById("tpSignup").onclick=async()=>{try{status.textContent="Création…";const d=await authRequest("signup",{email:document.getElementById("tpEmail").value.trim(),password:document.getElementById("tpPassword").value});if(d?.access_token){await setSession(d);await refresh();await syncAll()}else{status.textContent="Email à confirmer";detail.textContent="Vérifie ta boîte mail, puis connecte-toi."}}catch(e){status.textContent="Erreur";detail.textContent=e.message}};
  document.getElementById("tpLogout").onclick=async()=>{await setSession(null);await refresh()};
  document.getElementById("tpSyncNow").onclick=async()=>{try{status.textContent="Synchronisation…";const r=await syncAll();if(r.changed)location.reload();else{status.textContent="Connectée";detail.textContent="À jour."}}catch(e){status.textContent="Erreur";detail.textContent=e.message}};
  refresh().then(async()=>{if(await getSession()){try{const r=await syncAll();if(r.changed)location.reload()}catch(e){detail.textContent=e.message}}});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",injectUI);else injectUI();
