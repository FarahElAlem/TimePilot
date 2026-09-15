export const WORK_MINUTES = 480;
export const REQUIRED_PAUSE_MINUTES = 30;

export function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function minutesFromMidnight(timestamp) {
  const d = new Date(timestamp);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

export function formatClockFromMinutes(total) {
  if (!Number.isFinite(total)) return "--:--";
  const rounded = Math.round(total);
  const normalized = ((rounded % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatClockFromTimestamp(ts) {
  if (!ts) return "--:--";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function formatDuration(minutes) {
  if (!Number.isFinite(minutes)) return "00h00";
  const safe = Math.max(0, Math.floor(minutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, "0")}h${String(m).padStart(2, "0")}`;
}

export function parseTimeToMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || "");
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function buildRangeTimestamps(startValue, endValue, baseDate = new Date()) {
  const startMinutes = parseTimeToMinutes(startValue);
  const endMinutes = parseTimeToMinutes(endValue);

  if (startMinutes === null || endMinutes === null) {
    throw new Error("Heure de début ou de fin invalide");
  }
  if (endMinutes <= startMinutes) {
    throw new Error("L’heure de fin doit être après l’heure de début");
  }

  const start = new Date(baseDate);
  start.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);

  const end = new Date(baseDate);
  end.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);

  return { startTs: start.getTime(), endTs: end.getTime() };
}

function assertNoTimedOverlap(day, startTs, endTs, excludedId = null, now = Date.now()) {
  const overlaps = (day?.pauses || []).some(p => {
    if (!p?.startTs || p.id === excludedId) return false;
    const otherEnd = p.endTs || now;
    return startTs < otherEnd && endTs > p.startTs;
  });
  if (overlaps) throw new Error("Cette période chevauche une autre pause");
}

export function createEmptyDay(date = localDateKey()) {
  return {
    date,
    arrivalTs: null,
    pauses: [],
    updatedAt: Date.now(),
    syncStatus: "local"
  };
}

export function activePause(day) {
  if (!day?.pauses?.length) return null;
  for (let i = day.pauses.length - 1; i >= 0; i -= 1) {
    const p = day.pauses[i];
    if (p?.startTs && !p.endTs) return p;
  }
  return null;
}

export function pauseEntryMinutes(pause, now = Date.now()) {
  if (Number.isFinite(pause?.durationMinutes)) {
    return Math.max(0, pause.durationMinutes);
  }
  if (!pause?.startTs) return 0;
  const end = pause.endTs || now;
  return Math.max(0, (end - pause.startTs) / 60000);
}

export function pauseMinutes(day, now = Date.now()) {
  if (!day?.pauses?.length) return 0;
  return day.pauses.reduce((sum, p) => sum + pauseEntryMinutes(p, now), 0);
}

export function timedPauseMinutes(day, now = Date.now()) {
  if (!day?.pauses?.length) return 0;
  return day.pauses.reduce((sum, p) => {
    if (!p?.startTs) return sum;
    return sum + pauseEntryMinutes(p, now);
  }, 0);
}

export function manualPauseMinutes(day) {
  if (!day?.pauses?.length) return 0;
  return day.pauses.reduce((sum, p) => {
    return sum + (Number.isFinite(p?.durationMinutes) ? Math.max(0, p.durationMinutes) : 0);
  }, 0);
}

export function addManualPause(day, minutes, now = Date.now()) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Saisis une durée supérieure à 0 minute");
  }
  return {
    ...day,
    pauses: [...(day.pauses || []), {
      id: crypto.randomUUID(),
      manual: true,
      source: "duration",
      durationMinutes: value,
      createdAt: now
    }],
    updatedAt: now,
    syncStatus: "pending"
  };
}

export function updatePauseDuration(day, pauseId, minutes, now = Date.now()) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Saisis une durée supérieure à 0 minute");
  }
  if (!(day.pauses || []).some(p => p.id === pauseId)) {
    throw new Error("Pause introuvable");
  }

  return {
    ...day,
    pauses: (day.pauses || []).map(p => p.id === pauseId ? {
      id: p.id,
      manual: true,
      source: "duration",
      durationMinutes: value,
      createdAt: p.createdAt || now,
      updatedAt: now
    } : p),
    updatedAt: now,
    syncStatus: "pending"
  };
}

export function addManualPauseRange(day, startValue, endValue, baseDate = new Date()) {
  const { startTs, endTs } = buildRangeTimestamps(startValue, endValue, baseDate);
  const now = Date.now();
  assertNoTimedOverlap(day, startTs, endTs, null, now);

  return {
    ...day,
    pauses: [...(day.pauses || []), {
      id: crypto.randomUUID(),
      manual: true,
      range: true,
      source: "range",
      startTs,
      endTs,
      createdAt: now
    }],
    updatedAt: now,
    syncStatus: "pending"
  };
}

export function updatePauseRange(day, pauseId, startValue, endValue, baseDate = new Date()) {
  const { startTs, endTs } = buildRangeTimestamps(startValue, endValue, baseDate);
  const now = Date.now();
  if (!(day.pauses || []).some(p => p.id === pauseId)) {
    throw new Error("Pause introuvable");
  }
  assertNoTimedOverlap(day, startTs, endTs, pauseId, now);

  return {
    ...day,
    pauses: (day.pauses || []).map(p => p.id === pauseId ? {
      id: p.id,
      manual: true,
      range: true,
      source: "range",
      startTs,
      endTs,
      createdAt: p.createdAt || now,
      updatedAt: now
    } : p),
    updatedAt: now,
    syncStatus: "pending"
  };
}

export function deletePause(day, pauseId, now = Date.now()) {
  if (!(day.pauses || []).some(p => p.id === pauseId)) return day;
  return {
    ...day,
    pauses: (day.pauses || []).filter(p => p.id !== pauseId),
    updatedAt: now,
    syncStatus: "pending"
  };
}

export function setTotalPauseMinutes(day, desiredMinutes, now = Date.now()) {
  const desired = Number(desiredMinutes);
  if (!Number.isFinite(desired) || desired < 0) {
    throw new Error("Durée de pause invalide");
  }

  const timed = timedPauseMinutes(day, now);
  if (desired + 0.01 < timed) {
    throw new Error("Le total saisi est inférieur aux pauses déjà pointées");
  }

  const otherPauses = (day.pauses || []).filter(p => !Number.isFinite(p?.durationMinutes));
  const manualNeeded = Math.max(0, desired - timed);
  const pauses = manualNeeded > 0
    ? [...otherPauses, {
        id: crypto.randomUUID(),
        manual: true,
        source: "duration",
        durationMinutes: manualNeeded,
        createdAt: now,
        totalOverride: true
      }]
    : otherPauses;

  return { ...day, pauses, updatedAt: now, syncStatus: "pending" };
}

export function calculateDay(day, now = Date.now()) {
  const hasArrival = Boolean(day?.arrivalTs);
  if (!hasArrival) {
    return {
      hasArrival: false,
      pauseMinutes: 0,
      countedPauseMinutes: REQUIRED_PAUSE_MINUTES,
      workedMinutes: 0,
      remainingWorkMinutes: WORK_MINUTES,
      departureMinutes: null,
      mandatoryPauseRemaining: REQUIRED_PAUSE_MINUTES,
      activePause: null,
      minutesUntilDeparture: null
    };
  }

  const arrivalMinutes = minutesFromMidnight(day.arrivalTs);
  const totalPause = pauseMinutes(day, now);
  const countedPause = Math.max(REQUIRED_PAUSE_MINUTES, totalPause);
  const elapsed = Math.max(0, (now - day.arrivalTs) / 60000);
  const worked = Math.max(0, Math.min(WORK_MINUTES, elapsed - totalPause));
  const remaining = Math.max(0, WORK_MINUTES - worked);
  const departureMinutes = arrivalMinutes + WORK_MINUTES + countedPause;
  const nowMinutes = minutesFromMidnight(now);

  return {
    hasArrival: true,
    pauseMinutes: totalPause,
    countedPauseMinutes: countedPause,
    workedMinutes: worked,
    remainingWorkMinutes: remaining,
    departureMinutes,
    mandatoryPauseRemaining: Math.max(0, REQUIRED_PAUSE_MINUTES - totalPause),
    activePause: activePause(day),
    minutesUntilDeparture: Math.max(0, departureMinutes - nowMinutes)
  };
}

export function setArrivalNow(day, now = Date.now()) {
  return { ...day, arrivalTs: now, updatedAt: now, syncStatus: "pending" };
}

export function setArrivalManual(day, timeValue, now = new Date()) {
  const minutes = parseTimeToMinutes(timeValue);
  if (minutes === null) throw new Error("Heure invalide");
  const d = new Date(now);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return { ...day, arrivalTs: d.getTime(), updatedAt: Date.now(), syncStatus: "pending" };
}

export function startPause(day, now = Date.now()) {
  if (!day?.arrivalTs || activePause(day)) return day;
  return {
    ...day,
    pauses: [...(day.pauses || []), {
      id: crypto.randomUUID(),
      source: "timer",
      startTs: now,
      endTs: null,
      createdAt: now
    }],
    updatedAt: now,
    syncStatus: "pending"
  };
}

export function stopPause(day, now = Date.now()) {
  const current = activePause(day);
  if (!current) return day;
  return {
    ...day,
    pauses: (day.pauses || []).map(p => p.id === current.id ? { ...p, endTs: now, updatedAt: now } : p),
    updatedAt: now,
    syncStatus: "pending"
  };
}