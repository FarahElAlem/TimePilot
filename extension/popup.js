import {
  localDateKey, createEmptyDay, calculateDay, setArrivalNow,
  startPause, stopPause, formatClockFromTimestamp, formatClockFromMinutes,
  formatDuration, activePause, addManualPause, setTotalPauseMinutes,
  addManualPauseRange
} from "./core.js";

const $ = id => document.getElementById(id);
const today = localDateKey();
const KEEP_FULL_DAYS = 90;
const KEEP_TOTAL_DAYS = 365;
let day = createEmptyDay(today);
let timer = null;

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
  const all = await chrome.storage.local.get(null);
  const fullCutoff = dateDaysAgo(KEEP_FULL_DAYS);
  const deleteCutoff = dateDaysAgo(KEEP_TOTAL_DAYS);
  const updates = {};
  const removals = [];
  let archivedCount = 0, deletedCount = 0;

  for (const [key, item] of Object.entries(all)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !item) continue;
    if (key < deleteCutoff) {
      removals.push(key);
      deletedCount++;
    } else if (key < fullCutoff && !item.archived && key !== today) {
      updates[key] = compactDay(item);
      archivedCount++;
    }
  }

  if (Object.keys(updates).length) await chrome.storage.local.set(updates);
  if (removals.length) await chrome.storage.local.remove(removals);
  return { archivedCount, deletedCount };
}

async function refreshStorageSize() {
  const all = await chrome.storage.local.get(null);
  $("storageSize").textContent = humanBytes(new Blob([JSON.stringify(all)]).size);
}

async function loadDay() {
  const data = await chrome.storage.local.get(today);
  day = data[today] || createEmptyDay(today);
}

async function persist() {
  await chrome.storage.local.set({ [today]: day });
  await refreshStorageSize();
}

function message(text) {
  $("message").textContent = text || "";
}

function populatePickers() {
  const hours = Array.from({length:24},(_,i)=>`<option value="${String(i).padStart(2,"0")}">${String(i).padStart(2,"0")}</option>`).join("");
  const minutes = Array.from({length:60},(_,i)=>`<option value="${String(i).padStart(2,"0")}">${String(i).padStart(2,"0")}</option>`).join("");

  ["arrivalHour","pauseStartHour","pauseEndHour"].forEach(id => $(id).innerHTML = hours);
  ["arrivalMinute","pauseStartMinute","pauseEndMinute"].forEach(id => $(id).innerHTML = minutes);
}

function setPicker(prefix, ts) {
  const d = new Date(ts || Date.now());
  $(`${prefix}Hour`).value = String(d.getHours()).padStart(2,"0");
  $(`${prefix}Minute`).value = String(d.getMinutes()).padStart(2,"0");
}

function pickerValue(prefix) {
  return `${$(`${prefix}Hour`).value}:${$(`${prefix}Minute`).value}`;
}

function pickerMinutes(prefix) {
  return Number($(`${prefix}Hour`).value) * 60 + Number($(`${prefix}Minute`).value);
}

function updatePreview() {
  const diff = pickerMinutes("pauseEnd") - pickerMinutes("pauseStart");
  $("pausePreview").textContent = diff > 0 ? `Durée : ${diff} min` : "Durée : heure de fin à corriger";
}

function setMode(mode) {
  const range = mode === "range";
  $("modeRange").classList.toggle("active", range);
  $("modeTotal").classList.toggle("active", !range);
  $("rangePanel").hidden = !range;
  $("totalPanel").hidden = range;
}

function render() {
  const calc = calculateDay(day);
  const progress = Math.max(0, Math.min(100, (calc.workedMinutes / 480) * 100));

  $("arrivalDisplay").textContent = day.arrivalTs ? formatClockFromTimestamp(day.arrivalTs) : "Non pointée";
  $("clockInBtn").disabled = Boolean(day.arrivalTs);
  $("clockInBtn").textContent = day.arrivalTs ? "Pointée" : "Pointer";
  $("pauseBtn").disabled = !day.arrivalTs;
  $("worked").textContent = formatDuration(calc.workedMinutes);
  $("remaining").textContent = formatDuration(calc.remainingWorkMinutes);
  $("pauseTotal").textContent = formatDuration(calc.pauseMinutes);
  $("progressBar").style.width = `${progress}%`;

  const requiredDone = Math.min(30, calc.pauseMinutes);
  const extraPause = Math.max(0, calc.pauseMinutes - 30);
  $("mandatoryPauseState").textContent = `${Math.floor(requiredDone)} / 30 min${requiredDone >= 30 ? " ✓" : ""}`;
  $("extraPauseState").textContent = `${Math.floor(extraPause)} min`;
  $("pauseExplanation").textContent =
    `Pause totale : ${Math.floor(calc.pauseMinutes)} min • ` +
    `${requiredDone >= 30 ? "30 min obligatoires incluses" : Math.ceil(30-requiredDone) + " min obligatoires restantes"}` +
    `${extraPause > 0 ? ` • +${Math.floor(extraPause)} min supplémentaires` : ""}`;
  $("statusDot").className = "status-dot";

  if (!day.arrivalTs) {
    $("departure").textContent = "--:--";
    $("status").textContent = "Journée non démarrée";
    $("pauseInfo").textContent = "30 min de pause minimum.";
    $("pauseBtn").textContent = "Commencer une pause";
    return;
  }

  $("departure").textContent = formatClockFromMinutes(calc.departureMinutes);
  $("departureHint").textContent = calc.pauseMinutes <= 30
    ? "Pause obligatoire de 30 min incluse"
    : "Départ ajusté à la pause réelle";

  if (activePause(day)) {
    $("status").textContent = "En pause";
    $("pauseBtn").textContent = "Reprendre le travail";
    $("pauseInfo").textContent = `Pause totale : ${formatDuration(calc.pauseMinutes)}`;
    $("statusDot").classList.add("paused");
  } else {
    $("status").textContent = calc.remainingWorkMinutes <= 0 ? "Journée terminée" : "Au travail";
    $("pauseBtn").textContent = "Commencer une pause";
    $("pauseInfo").textContent = calc.mandatoryPauseRemaining > 0
      ? `${Math.ceil(calc.mandatoryPauseRemaining)} min obligatoires restantes`
      : "Pause obligatoire effectuée";
    $("statusDot").classList.add("active");
  }
}

$("clockInBtn").addEventListener("click", async () => {
  day = setArrivalNow(day);
  await persist();
  setPicker("arrival", day.arrivalTs);
  message("Arrivée enregistrée.");
  render();
});

$("toggleArrivalEditor").addEventListener("click", () => {
  $("arrivalEditor").hidden = !$("arrivalEditor").hidden;
  setPicker("arrival", day.arrivalTs || Date.now());
});

$("saveArrivalEditor").addEventListener("click", async () => {
  const d = new Date();
  d.setHours(Number($("arrivalHour").value), Number($("arrivalMinute").value), 0, 0);
  day = { ...day, arrivalTs: d.getTime(), updatedAt: Date.now(), syncStatus:"pending" };
  await persist();
  $("arrivalEditor").hidden = true;
  message("Heure corrigée.");
  render();
});

$("pauseBtn").addEventListener("click", async () => {
  if (!day.arrivalTs) return;
  day = activePause(day) ? stopPause(day) : startPause(day);
  await persist();
  message(activePause(day) ? "Pause commencée." : "Pause terminée.");
  render();
});

document.querySelectorAll(".quick-add").forEach(button => {
  button.addEventListener("click", async () => {
    if (!day.arrivalTs) return message("Pointe d’abord ton arrivée.");
    const minutes = Number(button.dataset.minutes);
    day = addManualPause(day, minutes);
    await persist();
    message(`+${minutes} min ajoutées.`);
    render();
  });
});

$("toggleManualPause").addEventListener("click", () => {
  $("manualPausePanel").hidden = !$("manualPausePanel").hidden;
  const now = new Date();
  setPicker("pauseEnd", now);
  setPicker("pauseStart", new Date(now.getTime() - 30*60000));
  updatePreview();
});

$("modeRange").addEventListener("click", () => setMode("range"));
$("modeTotal").addEventListener("click", () => setMode("total"));

["pauseStartHour","pauseStartMinute","pauseEndHour","pauseEndMinute"].forEach(id => {
  $(id).addEventListener("change", updatePreview);
});

$("addPauseRangeBtn").addEventListener("click", async () => {
  if (!day.arrivalTs) return message("Pointe d’abord ton arrivée.");
  try {
    day = addManualPauseRange(day, pickerValue("pauseStart"), pickerValue("pauseEnd"));
    await persist();
    $("manualPausePanel").hidden = true;
    message(`Pause ${pickerValue("pauseStart")} → ${pickerValue("pauseEnd")} ajoutée.`);
    render();
  } catch (e) {
    message(e?.message || "Pause invalide.");
  }
});

$("setPauseTotalBtn").addEventListener("click", async () => {
  if (!day.arrivalTs) return message("Pointe d’abord ton arrivée.");
  const raw = $("manualPauseTotal").value;
  if (raw === "") return message("Saisis le total.");
  try {
    day = setTotalPauseMinutes(day, Number(raw));
    await persist();
    $("manualPausePanel").hidden = true;
    message(`Pause totale : ${Math.round(Number(raw))} min.`);
    render();
  } catch (e) {
    message(e?.message || "Durée invalide.");
  }
});

$("cleanupBtn").addEventListener("click", async () => {
  const r = await applyRetentionPolicy();
  await refreshStorageSize();
  message(`${r.archivedCount} archivée(s), ${r.deletedCount} supprimée(s).`);
});

$("exportDataBtn").addEventListener("click", async () => {
  const all = await chrome.storage.local.get(null);
  const payload = JSON.stringify({
    exportedAt: new Date().toISOString(),
    policy: { fullDays: KEEP_FULL_DAYS, totalDays: KEEP_TOTAL_DAYS },
    data: all
  }, null, 2);
  const url = "data:application/json;charset=utf-8," + encodeURIComponent(payload);
  await chrome.downloads.download({
    url,
    filename: `timepilot-export-${today}.json`,
    saveAs: true
  });
});

async function init() {
  populatePickers();
  $("todayLabel").textContent = new Intl.DateTimeFormat("fr-FR",{weekday:"short",day:"2-digit",month:"2-digit"}).format(new Date());
  await applyRetentionPolicy();
  await loadDay();
  setPicker("arrival", day.arrivalTs || Date.now());
  const now = new Date();
  setPicker("pauseEnd", now);
  setPicker("pauseStart", new Date(now.getTime() - 30*60000));
  updatePreview();
  render();
  await refreshStorageSize();
  timer = setInterval(render, 1000);
}

window.addEventListener("unload", () => clearInterval(timer));
init();