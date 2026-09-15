const DB_NAME = "timepilot-db";
const DAYS = "days";
const ARCHIVE = "archive";
const VERSION = 2;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DAYS)) {
        db.createObjectStore(DAYS, { keyPath: "date" });
      }
      if (!db.objectStoreNames.contains(ARCHIVE)) {
        db.createObjectStore(ARCHIVE, { keyPath: "date" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txRequest(store, mode, action) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const os = tx.objectStore(store);
    const req = action(os);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

export async function getDay(date) {
  return (await txRequest(DAYS, "readonly", s => s.get(date))) || null;
}

export async function saveDay(day) {
  await txRequest(DAYS, "readwrite", s => s.put(day));
  return day;
}

export async function listDays(limit = 7) {
  const live = await txRequest(DAYS, "readonly", s => s.getAll());
  const archived = await txRequest(ARCHIVE, "readonly", s => s.getAll());
  return [...(live || []), ...(archived || [])]
    .sort((a,b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

export async function getAllData() {
  const live = await txRequest(DAYS, "readonly", s => s.getAll());
  const archived = await txRequest(ARCHIVE, "readonly", s => s.getAll());
  return { live: live || [], archived: archived || [] };
}

export async function archiveDay(summary) {
  await txRequest(ARCHIVE, "readwrite", s => s.put(summary));
  await txRequest(DAYS, "readwrite", s => s.delete(summary.date));
}

export async function deleteArchivedBefore(cutoffDate) {
  const rows = await txRequest(ARCHIVE, "readonly", s => s.getAll());
  const old = (rows || []).filter(r => r.date < cutoffDate);
  if (!old.length) return 0;

  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(ARCHIVE, "readwrite");
    const store = tx.objectStore(ARCHIVE);
    old.forEach(r => store.delete(r.date));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  return old.length;
}

export async function clearAllData() {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction([DAYS, ARCHIVE], "readwrite");
    tx.objectStore(DAYS).clear();
    tx.objectStore(ARCHIVE).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function estimateStorageBytes() {
  const data = await getAllData();
  return new Blob([JSON.stringify(data)]).size;
}