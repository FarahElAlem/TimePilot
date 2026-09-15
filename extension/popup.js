import {
  localDateKey, createEmptyDay, calculateDay, setArrivalNow,
  startPause, stopPause, formatClockFromTimestamp, formatClockFromMinutes,
  formatDuration, activePause, addManualPause, addManualPauseRange,
  updatePauseDuration, updatePauseRange, deletePause, pauseEntryMinutes
} from "./core.js";

const $ = id => document.getElementById(id);
const today = localDateKey();
const KEEP_FULL_DAYS = 90;
const KEEP_TOTAL_DAYS = 365;
let day = createEmptyDay(today);
let timer = null;
let editingPauseId = null;

function dateDaysAgo(days) {
  const d = new Date();
  d.setHours(12,0,0,0);
  d.setDate(d.getDate() - days);
  return localDateKey(d);
}

function humanBytes(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} Ko`;
  return `${(bytes/(1024*1024)).toFixed(2)} Mo`;
}

function compactDay(item) {
  const calc = calculateDay(item, item.updatedAt || Date.now());
  return {
    date: item.date, archived: true, arrivalTs: item.arrivalTs || null,
    pauseMinutes: Math.round(calc.pauseMinutes), workedMinutes: Math.round(calc.workedMinutes),
    departureMinutes: calc.departureMinutes, updatedAt: item.updatedAt || Date.now()
  };
}

async function applyRetentionPolicy() {
  const all = await chrome.storage.local.get(null);
  const fullCutoff = dateDaysAgo(KEEP_FULL_DAYS), deleteCutoff = dateDaysAgo(KEEP_TOTAL_DAYS);
  const updates = {}, removals = [];
  let archivedCount = 0, deletedCount = 0;
  for (const [key,item] of Object.entries(all)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !item) continue;
    if (key < deleteCutoff) { removals.push(key); deletedCount++; }
    else if (key < fullCutoff && !item.archived && key !== today) { updates[key] = compactDay(item); archivedCount++; }
  }
  if (Object.keys(updates).length) await chrome.storage.local.set(updates);
  if (removals.length) await chrome.storage.local.remove(removals);
  return { archivedCount, deletedCount };
}

async function refreshStorageSize() {
  const all = await chrome.storage.local.get(null);
  $("storageSize").textContent = humanBytes(new Blob([JSON.stringify(all)]).size);
}
async function loadDay() { const data = await chrome.storage.local.get(today); day = data[today] || createEmptyDay(today); }
async function persist() { await chrome.storage.local.set({ [today]: day }); await refreshStorageSize(); }
function message(text) { $("message").textContent = text || ""; }

function populatePickers() {
  const hours=Array.from({length:24},(_,i)=>`<option value="${String(i).padStart(2,"0")}">${String(i).padStart(2,"0")}</option>`).join("");
  const minutes=Array.from({length:60},(_,i)=>`<option value="${String(i).padStart(2,"0")}">${String(i).padStart(2,"0")}</option>`).join("");
  ["arrivalHour","pauseStartHour","pauseEndHour"].forEach(id=>$(id).innerHTML=hours);
  ["arrivalMinute","pauseStartMinute","pauseEndMinute"].forEach(id=>$(id).innerHTML=minutes);
}
function setPicker(prefix,ts){const d=new Date(ts||Date.now());$(`${prefix}Hour`).value=String(d.getHours()).padStart(2,"0");$(`${prefix}Minute`).value=String(d.getMinutes()).padStart(2,"0");}
function pickerValue(prefix){return `${$(`${prefix}Hour`).value}:${$(`${prefix}Minute`).value}`;}
function pickerMinutes(prefix){return Number($(`${prefix}Hour`).value)*60+Number($(`${prefix}Minute`).value);}
function updatePreview(){const diff=pickerMinutes("pauseEnd")-pickerMinutes("pauseStart");$("pausePreview").textContent=diff>0?`Durée : ${diff} min`:"Durée : heure de fin à corriger";}

function injectPauseUI() {
  $("toggleManualPause").textContent = "+ Ajouter une pause";
  $("modeRange").textContent = "Période";
  $("modeTotal").textContent = "Durée";
  $("manualPauseTotal").placeholder = "7";
  $("manualPauseTotal").min = "1";
  $("setPauseTotalBtn").textContent = "Ajouter cette pause";
  if (!$("cancelPauseEditBtn")) $("manualPausePanel").insertAdjacentHTML("beforeend", `<button id="cancelPauseEditBtn" class="primary full" type="button">Fermer</button>`);
  if (!$("pauseList")) $("manualPausePanel").insertAdjacentHTML("afterend", `<div id="pauseListSection" class="tp-list-wrap"><div class="tp-list-head"><strong id="pauseCount">0 pause</strong><span id="pauseListTotal">0 min</span></div><div id="pauseList" class="tp-list"></div></div>`);
  if (!$("tpPauseStyles")) document.head.insertAdjacentHTML("beforeend", `<style id="tpPauseStyles">.tp-list-wrap{margin-top:10px;padding-top:9px;border-top:1px solid #edf0f3}.tp-list-head{display:flex;align-items:center;justify-content:space-between;font-size:10px;margin-bottom:5px}.tp-list-head span{background:#f1f3f5;border-radius:999px;padding:4px 7px;font-weight:800;color:#4b5563}.tp-list{display:grid;gap:5px}.tp-empty{text-align:center;padding:7px 0;color:#9ca3af;font-size:9px}.tp-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px;align-items:center;border:1px solid #e8ebef;border-radius:9px;padding:7px;background:#fff}.tp-title{font-size:10px;font-weight:800}.tp-meta{font-size:8px;color:#6b7280;margin-top:2px}.tp-badge{display:inline-block;margin-left:4px;font-size:7px;text-transform:uppercase;border-radius:999px;padding:2px 4px;background:#eef2f7;color:#4b5563}.tp-badge.live{background:#fef3c7;color:#92400e}.tp-actions{display:grid;gap:3px}.tp-actions button{border:0;border-radius:6px;min-height:24px;padding:0 5px;font-size:7px;font-weight:800;background:#f1f3f5;color:#374151}.tp-actions .delete{background:#fff1f2;color:#9f1239}</style>`);
}

function setMode(mode){const range=mode==="range";$("modeRange").classList.toggle("active",range);$("modeTotal").classList.toggle("active",!range);$("rangePanel").hidden=!range;$("totalPanel").hidden=range;}
function resetPauseEditor(){editingPauseId=null;$("manualPauseTotal").value="";$("setPauseTotalBtn").textContent="Ajouter cette pause";$("addPauseRangeBtn").textContent="Ajouter cette période";const now=new Date();setPicker("pauseEnd",now);setPicker("pauseStart",new Date(now.getTime()-30*60000));updatePreview();setMode("duration");}
function openPauseEditorForEdit(id){const p=(day.pauses||[]).find(x=>x.id===id);if(!p)return;if(p.startTs&&!p.endTs)return message("Termine d’abord la pause en cours.");resetPauseEditor();editingPauseId=id;$("manualPausePanel").hidden=false;$("setPauseTotalBtn").textContent="Enregistrer";$("addPauseRangeBtn").textContent="Enregistrer";if(Number.isFinite(p.durationMinutes)){ $("manualPauseTotal").value=String(Math.round(p.durationMinutes));setMode("duration"); } else { setPicker("pauseStart",p.startTs);setPicker("pauseEnd",p.endTs);updatePreview();setMode("range"); }}

function renderPauseList(){const pauses=day.pauses||[];$("pauseCount").textContent=`${pauses.length} pause${pauses.length>1?"s":""}`;$("pauseListTotal").textContent=`${Math.floor(pauses.reduce((s,p)=>s+pauseEntryMinutes(p),0))} min`;if(!pauses.length){$("pauseList").innerHTML=`<div class="tp-empty">Aucune pause.</div>`;return;}$("pauseList").innerHTML=pauses.map((p,i)=>{const dur=Math.floor(pauseEntryMinutes(p)),live=Boolean(p.startTs&&!p.endTs);let title,meta,badge;if(Number.isFinite(p.durationMinutes)){title=`${dur} min`;meta=`Ajout manuel • #${i+1}`;badge="Durée";}else if(live){title=`${formatClockFromTimestamp(p.startTs)} → en cours`;meta=`${dur} min • #${i+1}`;badge="En cours";}else{title=`${formatClockFromTimestamp(p.startTs)} → ${formatClockFromTimestamp(p.endTs)}`;meta=`${dur} min • #${i+1}`;badge=p.manual||p.range?"Période":"Pointée";}return `<div class="tp-item" data-pause-id="${p.id}"><div><div class="tp-title">${title}<span class="tp-badge${live?" live":""}">${badge}</span></div><div class="tp-meta">${meta}</div></div><div class="tp-actions">${live?"":`<button class="pause-edit">Modifier</button>`}<button class="pause-delete delete">${live?"Annuler":"Supprimer"}</button></div></div>`;}).join("");}

function render(){const calc=calculateDay(day),progress=Math.max(0,Math.min(100,(calc.workedMinutes/480)*100));$("arrivalDisplay").textContent=day.arrivalTs?formatClockFromTimestamp(day.arrivalTs):"Non pointée";$("clockInBtn").disabled=Boolean(day.arrivalTs);$("clockInBtn").textContent=day.arrivalTs?"Pointée":"Pointer";$("pauseBtn").disabled=!day.arrivalTs;$("worked").textContent=formatDuration(calc.workedMinutes);$("remaining").textContent=formatDuration(calc.remainingWorkMinutes);$("pauseTotal").textContent=formatDuration(calc.pauseMinutes);$("progressBar").style.width=`${progress}%`;const requiredDone=Math.min(30,calc.pauseMinutes),extraPause=Math.max(0,calc.pauseMinutes-30);$("mandatoryPauseState").textContent=`${Math.floor(requiredDone)} / 30 min${requiredDone>=30?" ✓":""}`;$("extraPauseState").textContent=`${Math.floor(extraPause)} min`;$("pauseExplanation").textContent=`Pause totale : ${Math.floor(calc.pauseMinutes)} min • ${requiredDone>=30?"30 min obligatoires incluses":Math.ceil(30-requiredDone)+" min obligatoires restantes"}${extraPause>0?` • +${Math.floor(extraPause)} min supplémentaires`:""}`;$("statusDot").className="status-dot";renderPauseList();if(!day.arrivalTs){$("departure").textContent="--:--";$("status").textContent="Journée non démarrée";$("pauseInfo").textContent="30 min de pause minimum.";$("pauseBtn").textContent="Commencer une pause";return;}$("departure").textContent=formatClockFromMinutes(calc.departureMinutes);$("departureHint").textContent=calc.pauseMinutes<=30?"Pause obligatoire de 30 min incluse":"Départ ajusté à la pause réelle";if(activePause(day)){$("status").textContent="En pause";$("pauseBtn").textContent="Reprendre le travail";$("pauseInfo").textContent=`Pause totale : ${formatDuration(calc.pauseMinutes)}`;$("statusDot").classList.add("paused");}else{$("status").textContent=calc.remainingWorkMinutes<=0?"Journée terminée":"Au travail";$("pauseBtn").textContent="Commencer une pause";$("pauseInfo").textContent=calc.mandatoryPauseRemaining>0?`${Math.ceil(calc.mandatoryPauseRemaining)} min obligatoires restantes`:"Pause obligatoire effectuée";$("statusDot").classList.add("active");}}

injectPauseUI();

$("clockInBtn").addEventListener("click",async()=>{day=setArrivalNow(day);await persist();setPicker("arrival",day.arrivalTs);message("Arrivée enregistrée.");render();});
$("toggleArrivalEditor").addEventListener("click",()=>{$("arrivalEditor").hidden=!$("arrivalEditor").hidden;setPicker("arrival",day.arrivalTs||Date.now());});
$("saveArrivalEditor").addEventListener("click",async()=>{const d=new Date();d.setHours(Number($("arrivalHour").value),Number($("arrivalMinute").value),0,0);day={...day,arrivalTs:d.getTime(),updatedAt:Date.now(),syncStatus:"pending"};await persist();$("arrivalEditor").hidden=true;message("Heure corrigée.");render();});
$("pauseBtn").addEventListener("click",async()=>{if(!day.arrivalTs)return;const was=Boolean(activePause(day));day=was?stopPause(day):startPause(day);await persist();message(was?"Pause terminée.":"Pause commencée.");render();});
document.querySelectorAll(".quick-add").forEach(b=>b.addEventListener("click",async()=>{if(!day.arrivalTs)return message("Pointe d’abord ton arrivée.");const m=Number(b.dataset.minutes);try{day=addManualPause(day,m);await persist();message(`+${m} min ajoutées comme nouvelle pause.`);render();}catch(e){message(e?.message||"Durée invalide.");}}));
$("toggleManualPause").addEventListener("click",()=>{if(!day.arrivalTs)return message("Pointe d’abord ton arrivée.");if($("manualPausePanel").hidden){resetPauseEditor();$("manualPausePanel").hidden=false;}else $("manualPausePanel").hidden=true;});
$("cancelPauseEditBtn").addEventListener("click",()=>{$("manualPausePanel").hidden=true;resetPauseEditor();});
$("modeRange").addEventListener("click",()=>setMode("range"));$("modeTotal").addEventListener("click",()=>setMode("duration"));
["pauseStartHour","pauseStartMinute","pauseEndHour","pauseEndMinute"].forEach(id=>$(id).addEventListener("change",updatePreview));
$("addPauseRangeBtn").addEventListener("click",async()=>{if(!day.arrivalTs)return message("Pointe d’abord ton arrivée.");try{const s=pickerValue("pauseStart"),e=pickerValue("pauseEnd");day=editingPauseId?updatePauseRange(day,editingPauseId,s,e):addManualPauseRange(day,s,e);await persist();message(editingPauseId?"Pause modifiée.":`Pause ${s} → ${e} ajoutée.`);$("manualPausePanel").hidden=true;resetPauseEditor();render();}catch(err){message(err?.message||"Pause invalide.");}});
$("setPauseTotalBtn").addEventListener("click",async()=>{if(!day.arrivalTs)return message("Pointe d’abord ton arrivée.");const raw=$("manualPauseTotal").value;if(raw==="")return message("Saisis la durée.");try{const m=Number(raw);day=editingPauseId?updatePauseDuration(day,editingPauseId,m):addManualPause(day,m);await persist();message(editingPauseId?"Pause modifiée.":`+${Math.round(m)} min ajoutées.`);$("manualPausePanel").hidden=true;resetPauseEditor();render();}catch(err){message(err?.message||"Durée invalide.");}});
$("pauseList").addEventListener("click",async ev=>{const row=ev.target.closest(".tp-item");if(!row)return;const id=row.dataset.pauseId;if(ev.target.closest(".pause-edit"))return openPauseEditorForEdit(id);if(ev.target.closest(".pause-delete")){const p=(day.pauses||[]).find(x=>x.id===id),live=Boolean(p?.startTs&&!p?.endTs);if(!confirm(live?"Annuler cette pause en cours ?":"Supprimer cette pause ?"))return;day=deletePause(day,id);if(editingPauseId===id){$("manualPausePanel").hidden=true;resetPauseEditor();}await persist();message(live?"Pause annulée.":"Pause supprimée.");render();}});
$("cleanupBtn").addEventListener("click",async()=>{const r=await applyRetentionPolicy();await refreshStorageSize();message(`${r.archivedCount} archivée(s), ${r.deletedCount} supprimée(s).`);});
$("exportDataBtn").addEventListener("click",async()=>{const all=await chrome.storage.local.get(null);const payload=JSON.stringify({exportedAt:new Date().toISOString(),policy:{fullDays:KEEP_FULL_DAYS,totalDays:KEEP_TOTAL_DAYS},data:all},null,2);const url="data:application/json;charset=utf-8,"+encodeURIComponent(payload);await chrome.downloads.download({url,filename:`timepilot-export-${today}.json`,saveAs:true});});

async function init(){populatePickers();$("todayLabel").textContent=new Intl.DateTimeFormat("fr-FR",{weekday:"short",day:"2-digit",month:"2-digit"}).format(new Date());await applyRetentionPolicy();await loadDay();setPicker("arrival",day.arrivalTs||Date.now());resetPauseEditor();render();await refreshStorageSize();timer=setInterval(render,1000);}
window.addEventListener("unload",()=>clearInterval(timer));init();