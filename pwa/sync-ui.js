const SUPABASE_URL = "https://nusrnzrdfknvcgqccrac.supabase.co";
const SUPABASE_KEY = "sb_publishable_pklir0169Qf5bghO2gO6MQ_eUP4edH4";
const SESSION_KEY = "timepilot-supabase-session";
const DB_NAME = "timepilot-db";
const DB_VERSION = 2;
const DAYS_STORE = "days";

const state = { syncing: false };

function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
}
function setSession(session) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}
function isExpired(session) {
  return !session?.access_token || (session.expires_at && Date.now() >= (session.expires_at * 1000 - 60000));
}
async function authRequest(path, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.msg || data?.message || data?.error_description || "Erreur d’authentification");
  return data;
}
async function validSession() {
  let session = getSession();
  if (!session) return null;
  if (isExpired(session) && session.refresh_token) {
    try {
      const refreshed = await authRequest("token?grant_type=refresh_token", { refresh_token: session.refresh_token });
      session = refreshed;
      setSession(session);
    } catch {
      setSession(null);
      return null;
    }
  }
  return session;
}
async function rest(path, options = {}) {
  const session = await validSession();
  if (!session?.access_token) throw new Error("Connexion requise");
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${session.access_token}`,
    ...(options.headers || {})
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...options, headers });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!res.ok) throw new Error(data?.message || data?.hint || `Erreur Supabase (${res.status})`);
  return data;
}
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DAYS_STORE)) db.createObjectStore(DAYS_STORE, { keyPath: "date" });
      if (!db.objectStoreNames.contains("archive")) db.createObjectStore("archive", { keyPath: "date" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function getLocalDays() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DAYS_STORE, "readonly");
    const req = tx.objectStore(DAYS_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function saveLocalDay(day) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DAYS_STORE, "readwrite");
    tx.objectStore(DAYS_STORE).put(day);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
function pauseToRemote(p, dayId, userId, stamp) {
  const duration = Number.isFinite(p?.durationMinutes) ? Math.max(1, Math.round(p.durationMinutes)) : null;
  let source = "timer";
  if (duration !== null) source = "duration";
  else if (p?.manual || p?.range) source = "range";
  return {
    id: p.id,
    user_id: userId,
    work_day_id: dayId,
    source,
    duration_minutes: duration,
    start_ts: duration === null && p.startTs ? new Date(p.startTs).toISOString() : null,
    end_ts: duration === null && p.endTs ? new Date(p.endTs).toISOString() : null,
    client_updated_at: stamp,
    deleted_at: null
  };
}
function remoteToPause(p) {
  if (p.duration_minutes != null) {
    return { id: p.id, manual: true, durationMinutes: Number(p.duration_minutes), createdAt: Number(p.client_updated_at || Date.now()) };
  }
  return {
    id: p.id,
    startTs: p.start_ts ? Date.parse(p.start_ts) : null,
    endTs: p.end_ts ? Date.parse(p.end_ts) : null,
    manual: p.source === "range" || p.source === "legacy",
    range: p.source === "range",
    createdAt: Number(p.client_updated_at || Date.now())
  };
}
async function pushDay(local, remoteDay, remotePauses, userId) {
  const stamp = Number(local.updatedAt || Date.now());
  const payload = [{
    user_id: userId,
    work_date: local.date,
    arrival_ts: local.arrivalTs ? new Date(local.arrivalTs).toISOString() : null,
    client_updated_at: stamp,
    deleted_at: null
  }];
  const saved = await rest("work_days?on_conflict=user_id,work_date&select=id,work_date,client_updated_at", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(payload)
  });
  const dayId = saved?.[0]?.id || remoteDay?.id;
  if (!dayId) throw new Error("Impossible de synchroniser la journée");

  const pauses = (local.pauses || []).filter(p => p?.id).map(p => pauseToRemote(p, dayId, userId, stamp));
  if (pauses.length) {
    await rest("work_pauses?on_conflict=id", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(pauses)
    });
  }
  const localIds = new Set(pauses.map(p => p.id));
  for (const old of remotePauses || []) {
    if (!localIds.has(old.id)) await rest(`work_pauses?id=eq.${encodeURIComponent(old.id)}`, { method: "DELETE" });
  }
  return true;
}
async function syncAll() {
  if (state.syncing || !navigator.onLine) return { changed: false, offline: !navigator.onLine };
  const session = await validSession();
  if (!session?.user?.id) return { changed: false, unauthenticated: true };
  state.syncing = true;
  try {
    const [localDays, remoteDays, remotePauses] = await Promise.all([
      getLocalDays(),
      rest("work_days?select=id,work_date,arrival_ts,client_updated_at&deleted_at=is.null&order=work_date.desc"),
      rest("work_pauses?select=id,work_day_id,source,duration_minutes,start_ts,end_ts,client_updated_at&deleted_at=is.null")
    ]);
    const localByDate = new Map(localDays.map(d => [d.date, d]));
    const remoteByDate = new Map((remoteDays || []).map(d => [d.work_date, d]));
    const pausesByDay = new Map();
    for (const p of remotePauses || []) {
      if (!pausesByDay.has(p.work_day_id)) pausesByDay.set(p.work_day_id, []);
      pausesByDay.get(p.work_day_id).push(p);
    }
    const dates = new Set([...localByDate.keys(), ...remoteByDate.keys()]);
    let changed = false;
    for (const date of dates) {
      const local = localByDate.get(date);
      const remote = remoteByDate.get(date);
      const localStamp = Number(local?.updatedAt || 0);
      const remoteStamp = Number(remote?.client_updated_at || 0);
      if (local && (!remote || localStamp >= remoteStamp)) {
        await pushDay(local, remote, remote ? pausesByDay.get(remote.id) || [] : [], session.user.id);
      } else if (remote) {
        const pulled = {
          date,
          arrivalTs: remote.arrival_ts ? Date.parse(remote.arrival_ts) : null,
          pauses: (pausesByDay.get(remote.id) || []).map(remoteToPause),
          updatedAt: remoteStamp || Date.now(),
          syncStatus: "synced"
        };
        await saveLocalDay(pulled);
        changed = true;
      }
    }
    return { changed, count: dates.size };
  } finally {
    state.syncing = false;
  }
}
function injectUI() {
  if (document.getElementById("tpCloudCard")) return;
  const card = document.createElement("section");
  card.id = "tpCloudCard";
  card.className = "card";
  card.innerHTML = `
    <div class="section-head"><div><p class="label">Synchronisation cloud</p><strong id="tpCloudStatus" class="section-value small">Non connectée</strong><p id="tpCloudDetail" class="muted">Connecte le même compte sur iPhone et Chrome.</p></div><span id="tpCloudDot" class="status-dot"></span></div>
    <div id="tpAuthForm" style="margin-top:12px;display:grid;gap:8px">
      <input id="tpEmail" type="email" autocomplete="email" placeholder="Email" style="min-height:44px;border:1px solid #d8dde3;border-radius:12px;padding:0 12px">
      <input id="tpPassword" type="password" autocomplete="current-password" placeholder="Mot de passe" style="min-height:44px;border:1px solid #d8dde3;border-radius:12px;padding:0 12px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button id="tpLogin" class="primary">Se connecter</button><button id="tpSignup" class="secondary">Créer un compte</button></div>
    </div>
    <div id="tpCloudActions" hidden style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px"><button id="tpSyncNow" class="primary">Synchroniser</button><button id="tpLogout" class="secondary">Déconnexion</button></div>`;
  const firstCard = document.querySelector(".hero.card") || document.querySelector(".card");
  firstCard?.insertAdjacentElement("afterend", card);

  const status = document.getElementById("tpCloudStatus"), detail = document.getElementById("tpCloudDetail"), dot = document.getElementById("tpCloudDot");
  const authForm = document.getElementById("tpAuthForm"), actions = document.getElementById("tpCloudActions");
  async function refresh() {
    const s = await validSession();
    const online = navigator.onLine;
    if (s?.user) {
      status.textContent = online ? "Connectée" : "Connectée • hors ligne";
      detail.textContent = s.user.email || "Compte TimePilot";
      authForm.hidden = true; actions.hidden = false; dot.className = `status-dot ${online ? "active" : "paused"}`;
    } else {
      status.textContent = "Non connectée"; detail.textContent = "Connecte le même compte sur iPhone et Chrome.";
      authForm.hidden = false; actions.hidden = true; dot.className = "status-dot";
    }
  }
  document.getElementById("tpLogin").onclick = async () => {
    try {
      status.textContent = "Connexion…";
      const data = await authRequest("token?grant_type=password", { email: document.getElementById("tpEmail").value.trim(), password: document.getElementById("tpPassword").value });
      setSession(data); await refresh();
      const r = await syncAll();
      if (r.changed) location.reload(); else detail.textContent = "Synchronisation terminée.";
    } catch (e) { detail.textContent = e.message; status.textContent = "Erreur"; }
  };
  document.getElementById("tpSignup").onclick = async () => {
    try {
      status.textContent = "Création…";
      const data = await authRequest("signup", { email: document.getElementById("tpEmail").value.trim(), password: document.getElementById("tpPassword").value });
      if (data?.access_token) { setSession(data); await refresh(); await syncAll(); }
      else { status.textContent = "Email à confirmer"; detail.textContent = "Vérifie ta boîte mail, puis connecte-toi."; }
    } catch (e) { detail.textContent = e.message; status.textContent = "Erreur"; }
  };
  document.getElementById("tpLogout").onclick = () => { setSession(null); refresh(); };
  document.getElementById("tpSyncNow").onclick = async () => {
    try { status.textContent = "Synchronisation…"; const r = await syncAll(); if (r.changed) location.reload(); else { status.textContent = "Connectée"; detail.textContent = "À jour."; } }
    catch (e) { status.textContent = "Erreur"; detail.textContent = e.message; }
  };
  window.addEventListener("online", async () => { await refresh(); try { const r = await syncAll(); if (r.changed) location.reload(); } catch {} });
  window.addEventListener("offline", refresh);
  refresh().then(async () => {
    if (getSession() && navigator.onLine) {
      try { const r = await syncAll(); if (r.changed) location.reload(); } catch (e) { detail.textContent = e.message; }
    }
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", injectUI);
else injectUI();
