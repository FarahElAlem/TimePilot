import {
  localDateKey, createEmptyDay, calculateDay, setArrivalNow,
  startPause, stopPause, formatClockFromTimestamp, formatClockFromMinutes,
  formatDuration, activePause, addManualPause, setTotalPauseMinutes,
  addManualPauseRange
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
  const start = pickerMinutes("pauseStart");
  const end = pickerMinutes("pauseEnd");
  const diff = end - start;
  $("manualPausePreview").textContent = diff > 0 ? `Durée : ${diff} min` : "Durée : heure de fin à corriger";
}

function updateDateLabel() {
  const now = new Date();
  $("todayLabel").textContent = new Intl.DateTimeFormat("fr-FR", {
    weekday:"long", day:"numeric", month:"long"
  }).format(now);
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
  $("pauseExplanation").innerHTML =
    `Pause totale : <strong>${Math.floor(calc.pauseMinutes)} min</strong> • ` +
    `${requiredDone >= 30 ? "30 min obligatoires incluses" : Math.ceil(30 - requiredDone) + " min obligatoires restantes"}` +
    `${extraPause > 0 ? ` • +${Math.floor(extraPause)} min supplémentaires` : ""}`;

  $("statusDot").className = "status-dot";

  if (!day.arrivalTs) {
    $("departure").textContent = "--:--";
    $("departureMini").textContent = "--:--";
    $("departureHint").textContent = "8h de travail + 30 min de pause obligatoire.";
    $("status").textContent = "Journée non démarrée";
    $("pauseInfo").textContent = "30 min de pause minimum.";
    $("pauseBtn").textContent = "Commencer une pause";
    return;
  }

  $("departure").textContent = formatClockFromMinutes(calc.departureMinutes);
  $("departureMini").textContent = formatClockFromMinutes(calc.departureMinutes);
  $("departureHint").textContent = calc.pauseMinutes <= 30
    ? "La pause obligatoire de 30 min est déjà incluse."
    : "Départ ajusté selon la durée réelle des pauses.";

  if (activePause(day)) {
    $("status").textContent = "En pause";
    $("pauseBtn").textContent = "Reprendre le travail";
    $("pauseInfo").textContent = `Pause totale : ${formatDuration(calc.pauseMinutes)}`;
    $("statusDot").classList.add("paused");
  } else {
    $("status").textContent = calc.remainingWorkMinutes <= 0 ? "Journée terminée" : "Au travail";
    $("pauseBtn").textContent = "Commencer une pause";
    $("pauseInfo").textContent = calc.mandatoryPauseRemaining > 0
      ? `${Math.ceil(calc.mandatoryPauseRemaining)} min de pause obligatoire restantes.`
      : "Pause obligatoire effectuée.";
    $("statusDot").classList.add("active");
  }
}

async function renderHistory() {
  const rows = await listDays(7);
  const host = $("history");

  if (!rows.length) {
    host.innerHTML = `<p class="muted">Aucune journée enregistrée.</p>`;
    return;
  }

  host.innerHTML = rows.map(item => {
    const d = new Date(item.date + "T12:00:00");
    const label = new Intl.DateTimeFormat("fr-FR",{weekday:"short",day:"2-digit",month:"2-digit"}).format(d);
    let pauseText = "00h00";
    let departureText = "--:--";

    if (item.archived) {
      pauseText = formatDuration(item.pauseMinutes || 0);
      departureText = item.departureMinutes == null ? "--:--" : formatClockFromMinutes(item.departureMinutes);
    } else {
      const c = calculateDay(item, item.date === today ? Date.now() : (item.updatedAt || Date.now()));
      pauseText = formatDuration(c.pauseMinutes);
      departureText = c.departureMinutes == null ? "--:--" : formatClockFromMinutes(c.departureMinutes);
    }

    return `<div class="history-row">
      <span class="history-date">${label}</span>
      <span class="history-meta">${formatClockFromTimestamp(item.arrivalTs)} • ${pauseText}</span>
      <strong>${departureText}</strong>
    </div>`;
  }).join("");
}

$("clockInBtn").addEventListener("click", async () => {
  day = setArrivalNow(day);
  await persist();
  setPicker("arrival", day.arrivalTs);
  setMessage(`Arrivée pointée à ${formatClockFromTimestamp(day.arrivalTs)}.`);
  render();
});

$("openArrivalEditor").addEventListener("click", () => {
  $("arrivalEditor").hidden = false;
  setPicker("arrival", day.arrivalTs || Date.now());
});

$("cancelArrivalEditor").addEventListener("click", () => {
  $("arrivalEditor").hidden = true;
});

$("saveArrivalEditor").addEventListener("click", async () => {
  const d = new Date();
  d.setHours(Number($("arrivalHour").value), Number($("arrivalMinute").value), 0, 0);

  day = {
    ...day,
    arrivalTs: d.getTime(),
    updatedAt: Date.now(),
    syncStatus: "pending"
  };

  await persist();
  $("arrivalEditor").hidden = true;
  setMessage(`Arrivée corrigée à ${formatClockFromTimestamp(day.arrivalTs)}.`);
  render();
});

$("pauseBtn").addEventListener("click", async () => {
  if (!day.arrivalTs) return;
  if (activePause(day)) {
    day = stopPause(day);
    setMessage("Pause terminée.");
  } else {
    day = startPause(day);
    setMessage("Pause commencée.");
  }
  await persist();
  render();
});

document.querySelectorAll(".quick-add").forEach(button => {
  button.addEventListener("click", async () => {
    if (!day.arrivalTs) {
      setMessage("Pointe d’abord ton arrivée.");
      return;
    }
    const minutes = Number(button.dataset.minutes);
    day = addManualPause(day, minutes);
    await persist();
    setMessage(`${minutes} min ajoutées à la pause.`);
    render();
  });
});

$("openManualPause").addEventListener("click", () => {
  $("manualPausePanel").hidden = !$("manualPausePanel").hidden;

  const now = new Date();
  const start = new Date(now.getTime() - 30 * 60000);
  setPicker("pauseStart", start);
  setPicker("pauseEnd", now);
  updatePausePreview();
});

function setPauseMode(mode) {
  const range = mode === "range";
  $("pauseModeRange").classList.toggle("active", range);
  $("pauseModeTotal").classList.toggle("active", !range);
  $("pauseRangePanel").hidden = !range;
  $("pauseTotalPanel").hidden = range;
}

$("pauseModeRange").addEventListener("click", () => setPauseMode("range"));
$("pauseModeTotal").addEventListener("click", () => setPauseMode("total"));

["pauseStartHour","pauseStartMinute","pauseEndHour","pauseEndMinute"].forEach(id => {
  $(id).addEventListener("change", updatePausePreview);
});

$("addPauseRangeBtn").addEventListener("click", async () => {
  if (!day.arrivalTs) {
    setMessage("Pointe d’abord ton arrivée.");
    return;
  }
  try {
    day = addManualPauseRange(day, pickerValue("pauseStart"), pickerValue("pauseEnd"));
    await persist();
    setMessage(`Pause ${pickerValue("pauseStart")} → ${pickerValue("pauseEnd")} ajoutée.`);
    $("manualPausePanel").hidden = true;
    render();
  } catch (error) {
    setMessage(error?.message || "Pause invalide.");
  }
});

$("setPauseTotalBtn").addEventListener("click", async () => {
  if (!day.arrivalTs) {
    setMessage("Pointe d’abord ton arrivée.");
    return;
  }

  const raw = $("manualPauseTotal").value;
  if (raw === "") {
    setMessage("Saisis le total de pause.");
    return;
  }

  try {
    const desired = Number(raw);
    day = setTotalPauseMinutes(day, desired);
    await persist();
    setMessage(`Pause totale mise à ${Math.round(desired)} min.`);
    $("manualPausePanel").hidden = true;
    render();
  } catch (error) {
    setMessage(error?.message || "Durée de pause invalide.");
  }
});

$("cleanupBtn").addEventListener("click", async () => {
  const result = await applyRetentionPolicy();
  await renderHistory();
  await refreshStorageSize();
  setMessage(`${result.archivedCount} archivée(s), ${result.deletedCount} supprimée(s).`);
});

$("exportDataBtn").addEventListener("click", async () => {
  const data = await getAllData();
  const blob = new Blob([JSON.stringify({
    exportedAt: new Date().toISOString(),
    policy: { fullDays: KEEP_FULL_DAYS, totalDays: KEEP_TOTAL_DAYS },
    ...data
  }, null, 2)], { type: "application/json" });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `timepilot-export-${today}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setMessage("Export créé.");
});

$("clearAllBtn").addEventListener("click", async () => {
  const ok = confirm("Effacer définitivement toutes les données TimePilot de cet appareil ?");
  if (!ok) return;

  await clearAllData();
  day = createEmptyDay(today);
  render();
  await renderHistory();
  await refreshStorageSize();
  setMessage("Données locales effacées.");
});

window.addEventListener("online", () => $("offlineBadge").textContent = "En ligne");
window.addEventListener("offline", () => $("offlineBadge").textContent = "Hors ligne");

async function init() {
  populateTimeSelects();
  updateDateLabel();
  await applyRetentionPolicy();
  day = (await getDay(today)) || createEmptyDay(today);
  $("offlineBadge").textContent = navigator.onLine ? "En ligne" : "Hors ligne";

  setPicker("arrival", day.arrivalTs || Date.now());
  const now = new Date();
  setPicker("pauseEnd", now);
  setPicker("pauseStart", new Date(now.getTime() - 30 * 60000));

  render();
  updatePausePreview();
  await renderHistory();
  await refreshStorageSize();

  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("./sw.js"); } catch {}
  }

  tick = setInterval(render, 1000);
}

window.addEventListener("pagehide", () => clearInterval(tick), { once: true });
init();