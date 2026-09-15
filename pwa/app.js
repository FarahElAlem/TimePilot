import {
  localDateKey, createEmptyDay, calculateDay, setArrivalNow,
  startPause, stopPause, formatClockFromTimestamp, formatClockFromMinutes,
  formatDuration, activePause, addManualPause, addManualPauseRange,
  updatePauseDuration, updatePauseRange, deletePause, pauseEntryMinutes
} from "./core.js";

import {
  getDay, saveDay, listDays, getAllData, archiveDay, deleteArchivedBefore,
  clearAllData, estimateStorageBytes
} from "./db.js";

const $ = id => document.getElementById(id);
const today = localDateKey();
const KEEP_FULL_DAYS = 90;
const KEEP_TOTAL_DAYS = 365;
let day = createEmptyDay(today);
let tick = null;
let editingPauseId = null;

function setMessage(text) {
  $("message").textContent = text || "";
  if (text) setTimeout(() => {
    if ($("message").textContent === text) $("message").textContent = "";
  }, 3500);
}

function dateDaysAgo(days) {
  const d = new Date();
  d.setHours(12,0,0,0);
  d.setDate(d.getDate() - days);
  return localDateKey(d);
}

function humanBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes || 0} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}

function compactDay(item) {
  const calc = calculateDay(item, item.updatedAt || Date.now());
  return {
    date: item.date,
    archived: true,
    arrivalTs: item.arrivalTs || null,
    pauseMinutes: Math.round(calc.pauseMinutes),
    workedMinutes: Math.round(calc.workedMinutes),
    departureMinutes: calc.departureMinutes,
    updatedAt: item.updatedAt || Date.now()
  };
}

async function applyRetentionPolicy() {
  const data = await getAllData();
  const fullCutoff = dateDaysAgo(KEEP_FULL_DAYS);
  const deleteCutoff = dateDaysAgo(KEEP_TOTAL_DAYS);
  let archivedCount = 0;
  for (const item of data.live) {
    if (item.date < fullCutoff && item.date !== today) {
      await archiveDay(compactDay(item));
      archivedCount++;
    }
  }
  const deletedCount = await deleteArchivedBefore(deleteCutoff);
  return { archivedCount, deletedCount };
}

async function refreshStorageSize() {
  $("storageSize").textContent = humanBytes(await estimateStorageBytes());
}

async function persist() {
  await saveDay(day);
  await renderHistory();
  await refreshStorageSize();
}

function populateTimeSelects() {
  const hourSelects = ["arrivalHour","pauseStartHour","pauseEndHour"].map($);
  const minuteSelects = ["arrivalMinute","pauseStartMinute","pauseEndMinute"].map($);
  const hours = Array.from({length:24},(_,i)=>`<option value="${String(i).padStart(2,"0")}">${String(i).padStart(2,"0")}</option>`).join("");
  const minutes = Array.from({length:60},(_,i)=>`<option value="${String(i).padStart(2,"0")}">${String(i).padStart(2,"0")}</option>`).join("");
  hourSelects.forEach(s => s.innerHTML = hours);
  minuteSelects.forEach(s => s.innerHTML = minutes);
}

function setPicker(prefix, dateOrTs) {
  const d = dateOrTs instanceof Date ? dateOrTs : new Date(dateOrTs || Date.now());
  $(`${prefix}Hour`).value = String(d.getHours()).padStart(2,"0");
  $(`${prefix}Minute`).value = String(d.getMinutes()).padStart(2,"0");
}

function pickerValue(prefix) {
  return `${$(`${prefix}Hour`).value}:${$(`${prefix}Minute`).value}`;
}

function pickerMinutes(prefix) {
  return Number($(`${prefix}Hour`).value) * 60 + Number($(`${prefix}Minute`).value);
}

function updatePausePreview() {
  const diff = pickerMinutes("pauseEnd") - pickerMinutes("pauseStart");
  $("manualPausePreview").textContent = diff > 0 ? `Durée : ${diff} min` : "Durée : heure de fin à corriger";
}

function updateDateLabel() {
  $("todayLabel").textContent = new Intl.DateTimeFormat("fr-FR", {
    weekday:"long", day:"numeric", month:"long"
  }).format(new Date());
}

function injectPauseUI() {
  $("openManualPause").textContent = "+ Ajouter une pause manuellement";
  $("pauseModeRange").textContent = "Période";
  $("pauseModeTotal").textContent = "Durée";
  $("manualPauseTotal").placeholder = "7";
  $("manualPauseTotal").min = "1";
  $("setPauseTotalBtn").textContent = "Ajouter cette pause";
  const title = $("pauseTotalPanel").querySelector(".mini-title");
  if (title) title.textContent = "Durée de cette pause";
  const help = $("pauseTotalPanel").querySelector(".muted");
  if (help) help.textContent = "Cette durée s’ajoute aux pauses déjà enregistrées.";

  if (!$("cancelPauseEditBtn")) {
    $("manualPausePanel").insertAdjacentHTML("beforeend", `<button id="cancelPauseEditBtn" class="secondary full" type="button">Fermer</button>`);
  }
  if (!$("pauseList")) {
    $("manualPausePanel").insertAdjacentHTML("afterend", `
      <div id="pauseListSection" class="tp-pause-list-section">
        <div class="tp-pause-list-head"><strong id="pauseCount">0 pause</strong><span id="pauseListTotal">0 min</span></div>
        <div id="pauseList" class="tp-pause-list"></div>
      </div>`);
  }
  if (!$("tpPauseStyles")) {
    document.head.insertAdjacentHTML("beforeend", `<style id="tpPauseStyles">
      .tp-pause-list-section{margin-top:17px;padding-top:15px;border-top:1px solid #eceff2}.tp-pause-list-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:7px;font-size:12px}.tp-pause-list-head span{font-weight:800;background:#f1f3f5;padding:6px 9px;border-radius:999px;color:#374151}.tp-pause-list{display:grid;gap:7px}.tp-pause-empty{padding:12px 0;text-align:center;color:#9ca3af;font-size:12px}.tp-pause-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:11px 12px;border:1px solid #e8ebef;border-radius:13px;background:#fff}.tp-pause-title{font-size:13px;font-weight:800}.tp-pause-meta{margin-top:3px;color:#6b7280;font-size:11px}.tp-badge{display:inline-block;margin-left:7px;font-size:9px;font-weight:850;text-transform:uppercase;padding:3px 6px;border-radius:999px;background:#eef2f7;color:#4b5563}.tp-badge.live{background:#fef3c7;color:#92400e}.tp-pause-actions{display:flex;gap:5px}.tp-pause-actions button{border:0;border-radius:9px;min-height:34px;padding:0 9px;font-size:10px;font-weight:800;background:#f1f3f5;color:#374151}.tp-pause-actions .delete{background:#fff1f2;color:#9f1239}@media(max-width:520px){.tp-pause-item{grid-template-columns:1fr}.tp-pause-actions{justify-content:flex-end}}
    </style>`);
  }
}

function setPauseMode(mode) {
  const range = mode === "range";
  $("pauseModeRange").classList.toggle("active", range);
  $("pauseModeTotal").classList.toggle("active", !range);
  $("pauseRangePanel").hidden = !range;
  $("pauseTotalPanel").hidden = range;
}

function resetPauseEditor() {
  editingPauseId = null;
  $("manualPauseTotal").value = "";
  $("setPauseTotalBtn").textContent = "Ajouter cette pause";
  $("addPauseRangeBtn").textContent = "Ajouter cette période";
  const now = new Date();
  setPicker("pauseEnd", now);
  setPicker("pauseStart", new Date(now.getTime() - 30 * 60000));
  updatePausePreview();
  setPauseMode("duration");
}

function openPauseEditorForEdit(pauseId) {
  const pause = (day.pauses || []).find(p => p.id === pauseId);
  if (!pause) return;
  if (pause.startTs && !pause.endTs) return setMessage("Termine d’abord la pause en cours avant de la modifier.");
  resetPauseEditor();
  editingPauseId = pauseId;
  $("manualPausePanel").hidden = false;
  $("setPauseTotalBtn").textContent = "Enregistrer la modification";
  $("addPauseRangeBtn").textContent = "Enregistrer la modification";
  if (Number.isFinite(pause.durationMinutes)) {
    $("manualPauseTotal").value = String(Math.round(pause.durationMinutes));
    setPauseMode("duration");
  } else {
    setPicker("pauseStart", pause.startTs);
    setPicker("pauseEnd", pause.endTs);
    updatePausePreview();
    setPauseMode("range");
  }
}

function renderPauseList() {
  const pauses = day.pauses || [];
  $("pauseCount").textContent = `${pauses.length} pause${pauses.length > 1 ? "s" : ""}`;
  $("pauseListTotal").textContent = `${Math.floor(pauses.reduce((s,p)=>s+pauseEntryMinutes(p),0))} min`;
  if (!pauses.length) {
    $("pauseList").innerHTML = `<div class="tp-pause-empty">Aucune pause enregistrée.</div>`;
    return;
  }
  $("pauseList").innerHTML = pauses.map((pause,index) => {
    const duration = Math.floor(pauseEntryMinutes(pause));
    const active = Boolean(pause.startTs && !pause.endTs);
    let title, meta, badge;
    if (Number.isFinite(pause.durationMinutes)) {
      title = `${duration} min`; meta = `Ajout manuel • #${index+1}`; badge = "Durée";
    } else if (active) {
      title = `${formatClockFromTimestamp(pause.startTs)} → en cours`; meta = `${duration} min actuellement • #${index+1}`; badge = "En cours";
    } else {
      title = `${formatClockFromTimestamp(pause.startTs)} → ${formatClockFromTimestamp(pause.endTs)}`; meta = `${duration} min • #${index+1}`; badge = pause.manual || pause.range ? "Période" : "Pointée";
    }
    return `<div class="tp-pause-item" data-pause-id="${pause.id}"><div><div class="tp-pause-title">${title}<span class="tp-badge${active?" live":""}">${badge}</span></div><div class="tp-pause-meta">${meta}</div></div><div class="tp-pause-actions">${active?"":`<button class="pause-edit">Modifier</button>`}<button class="pause-delete delete">${active?"Annuler":"Supprimer"}</button></div></div>`;
  }).join("");
}

function render() {
  const calc = calculateDay(day);
  const progress = Math.max(0, Math.min(100, (calc.workedMinutes / 480) * 100));
  $("worked").textContent = formatDuration(calc.workedMinutes);
  $("pauseTotal").textContent = formatDuration(calc.pauseMinutes);
  $("remaining").textContent = formatDuration(calc.remainingWorkMinutes);
  $("progressBar").style.width = `${progress}%`;
  $("progressPct").textContent = `${Math.round(progress)}%`;
  $("progressRing").style.strokeDashoffset = String(113.097 * (1 - progress / 100));
  $("arrivalDisplay").textContent = day.arrivalTs ? formatClockFromTimestamp(day.arrivalTs) : "Non pointée";
  $("arrivalStatus").textContent = day.arrivalTs ? "Heure enregistrée sur cet appareil." : "Pointe ton arrivée en un clic.";
  $("clockInBtn").disabled = Boolean(day.arrivalTs);
  $("clockInBtn").textContent = day.arrivalTs ? "Pointée" : "Pointer";
  $("pauseBtn").disabled = !day.arrivalTs;
  const requiredDone = Math.min(30, calc.pauseMinutes);
  const extraPause = Math.max(0, calc.pauseMinutes - 30);
  $("mandatoryPauseState").textContent = `${Math.floor(requiredDone)} / 30 min${requiredDone >= 30 ? " ✓" : ""}`;
  $("extraPauseState").textContent = `${Math.floor(extraPause)} min`;
  $("pauseExplanation").innerHTML = `Pause totale : <strong>${Math.floor(calc.pauseMinutes)} min</strong> • ${requiredDone >= 30 ? "30 min obligatoires incluses" : Math.ceil(30-requiredDone)+" min obligatoires restantes"}${extraPause>0?` • +${Math.floor(extraPause)} min supplémentaires`:""}`;
  renderPauseList();
  $("statusDot").className = "status-dot";
  if (!day.arrivalTs) {
    $("departure").textContent = "--:--"; $("departureMini").textContent = "--:--";
    $("departureHint").textContent = "8h de travail + 30 min de pause obligatoire.";
    $("status").textContent = "Journée non démarrée"; $("pauseInfo").textContent = "30 min de pause minimum."; $("pauseBtn").textContent = "Commencer une pause"; return;
  }
  $("departure").textContent = formatClockFromMinutes(calc.departureMinutes);
  $("departureMini").textContent = formatClockFromMinutes(calc.departureMinutes);
  $("departureHint").textContent = calc.pauseMinutes <= 30 ? "La pause obligatoire de 30 min est déjà incluse." : "Départ ajusté selon la durée réelle des pauses.";
  if (activePause(day)) {
    $("status").textContent = "En pause"; $("pauseBtn").textContent = "Reprendre le travail"; $("pauseInfo").textContent = `Pause totale : ${formatDuration(calc.pauseMinutes)}`; $("statusDot").classList.add("paused");
  } else {
    $("status").textContent = calc.remainingWorkMinutes <= 0 ? "Journée terminée" : "Au travail"; $("pauseBtn").textContent = "Commencer une pause";
    $("pauseInfo").textContent = calc.mandatoryPauseRemaining > 0 ? `${Math.ceil(calc.mandatoryPauseRemaining)} min de pause obligatoire restantes.` : "Pause obligatoire effectuée."; $("statusDot").classList.add("active");
  }
}

async function renderHistory() {
  const rows = await listDays(7), host = $("history");
  if (!rows.length) return host.innerHTML = `<p class="muted">Aucune journée enregistrée.</p>`;
  host.innerHTML = rows.map(item => {
    const d = new Date(item.date + "T12:00:00");
    const label = new Intl.DateTimeFormat("fr-FR",{weekday:"short",day:"2-digit",month:"2-digit"}).format(d);
    let pauseText="00h00", departureText="--:--";
    if (item.archived) { pauseText=formatDuration(item.pauseMinutes||0); departureText=item.departureMinutes==null?"--:--":formatClockFromMinutes(item.departureMinutes); }
    else { const c=calculateDay(item,item.date===today?Date.now():(item.updatedAt||Date.now())); pauseText=formatDuration(c.pauseMinutes); departureText=c.departureMinutes==null?"--:--":formatClockFromMinutes(c.departureMinutes); }
    return `<div class="history-row"><span class="history-date">${label}</span><span class="history-meta">${formatClockFromTimestamp(item.arrivalTs)} • ${pauseText}</span><strong>${departureText}</strong></div>`;
  }).join("");
}

injectPauseUI();

$("clockInBtn").addEventListener("click", async () => { day=setArrivalNow(day); await persist(); setPicker("arrival",day.arrivalTs); setMessage(`Arrivée pointée à ${formatClockFromTimestamp(day.arrivalTs)}.`); render(); });
$("openArrivalEditor").addEventListener("click", () => { $("arrivalEditor").hidden=false; setPicker("arrival",day.arrivalTs||Date.now()); });
$("cancelArrivalEditor").addEventListener("click", () => $("arrivalEditor").hidden=true);
$("saveArrivalEditor").addEventListener("click", async () => { const d=new Date(); d.setHours(Number($("arrivalHour").value),Number($("arrivalMinute").value),0,0); day={...day,arrivalTs:d.getTime(),updatedAt:Date.now(),syncStatus:"pending"}; await persist(); $("arrivalEditor").hidden=true; setMessage(`Arrivée corrigée à ${formatClockFromTimestamp(day.arrivalTs)}.`); render(); });
$("pauseBtn").addEventListener("click", async () => { if(!day.arrivalTs)return; const was=Boolean(activePause(day)); day=was?stopPause(day):startPause(day); await persist(); setMessage(was?"Pause terminée.":"Pause commencée."); render(); });

document.querySelectorAll(".quick-add").forEach(button => button.addEventListener("click", async () => { if(!day.arrivalTs)return setMessage("Pointe d’abord ton arrivée."); const minutes=Number(button.dataset.minutes); try{day=addManualPause(day,minutes);await persist();setMessage(`${minutes} min ajoutées comme nouvelle pause.`);render();}catch(e){setMessage(e?.message||"Durée invalide.");} }));

$("openManualPause").addEventListener("click", () => { if(!day.arrivalTs)return setMessage("Pointe d’abord ton arrivée."); if($("manualPausePanel").hidden){resetPauseEditor();$("manualPausePanel").hidden=false;}else $("manualPausePanel").hidden=true; });
$("cancelPauseEditBtn").addEventListener("click", () => { $("manualPausePanel").hidden=true; resetPauseEditor(); });
$("pauseModeRange").addEventListener("click", () => setPauseMode("range"));
$("pauseModeTotal").addEventListener("click", () => setPauseMode("duration"));
["pauseStartHour","pauseStartMinute","pauseEndHour","pauseEndMinute"].forEach(id => $(id).addEventListener("change",updatePausePreview));

$("addPauseRangeBtn").addEventListener("click", async () => { if(!day.arrivalTs)return setMessage("Pointe d’abord ton arrivée."); try{const start=pickerValue("pauseStart"),end=pickerValue("pauseEnd"); day=editingPauseId?updatePauseRange(day,editingPauseId,start,end):addManualPauseRange(day,start,end); await persist(); setMessage(editingPauseId?"Pause modifiée.":`Pause ${start} → ${end} ajoutée.`); $("manualPausePanel").hidden=true; resetPauseEditor(); render();}catch(e){setMessage(e?.message||"Pause invalide.");} });

$("setPauseTotalBtn").addEventListener("click", async () => { if(!day.arrivalTs)return setMessage("Pointe d’abord ton arrivée."); const raw=$("manualPauseTotal").value; if(raw==="")return setMessage("Saisis la durée de cette pause."); try{const minutes=Number(raw); day=editingPauseId?updatePauseDuration(day,editingPauseId,minutes):addManualPause(day,minutes); await persist(); setMessage(editingPauseId?"Pause modifiée.":`${Math.round(minutes)} min ajoutées comme nouvelle pause.`); $("manualPausePanel").hidden=true; resetPauseEditor(); render();}catch(e){setMessage(e?.message||"Durée invalide.");} });

$("pauseList").addEventListener("click", async event => { const row=event.target.closest(".tp-pause-item"); if(!row)return; const id=row.dataset.pauseId; if(event.target.closest(".pause-edit"))return openPauseEditorForEdit(id); if(event.target.closest(".pause-delete")){const p=(day.pauses||[]).find(x=>x.id===id),live=Boolean(p?.startTs&&!p?.endTs); if(!confirm(live?"Annuler cette pause en cours ?":"Supprimer cette pause ?"))return; day=deletePause(day,id); if(editingPauseId===id){$("manualPausePanel").hidden=true;resetPauseEditor();} await persist(); setMessage(live?"Pause en cours annulée.":"Pause supprimée."); render();} });

$("cleanupBtn").addEventListener("click", async () => { const r=await applyRetentionPolicy(); await renderHistory(); await refreshStorageSize(); setMessage(`${r.archivedCount} archivée(s), ${r.deletedCount} supprimée(s).`); });
$("exportDataBtn").addEventListener("click", async () => { const data=await getAllData(); const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),policy:{fullDays:KEEP_FULL_DAYS,totalDays:KEEP_TOTAL_DAYS},...data},null,2)],{type:"application/json"}); const url=URL.createObjectURL(blob),a=document.createElement("a"); a.href=url;a.download=`timepilot-export-${today}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage("Export créé."); });
$("clearAllBtn").addEventListener("click", async () => { if(!confirm("Effacer définitivement toutes les données TimePilot de cet appareil ?"))return; await clearAllData();day=createEmptyDay(today);$("manualPausePanel").hidden=true;resetPauseEditor();render();await renderHistory();await refreshStorageSize();setMessage("Données locales effacées."); });
window.addEventListener("online",()=>$("offlineBadge").textContent="En ligne"); window.addEventListener("offline",()=>$("offlineBadge").textContent="Hors ligne");

async function init() {
  populateTimeSelects(); updateDateLabel(); await applyRetentionPolicy(); day=(await getDay(today))||createEmptyDay(today); $("offlineBadge").textContent=navigator.onLine?"En ligne":"Hors ligne"; setPicker("arrival",day.arrivalTs||Date.now()); resetPauseEditor(); render(); await renderHistory(); await refreshStorageSize();
  if("serviceWorker" in navigator){try{await navigator.serviceWorker.register("./sw.js");}catch{}}
  tick=setInterval(render,1000);
}
window.addEventListener("pagehide",()=>clearInterval(tick),{once:true}); init();