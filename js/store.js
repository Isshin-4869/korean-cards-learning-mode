// 保存処理はこのモジュールだけが行う。get / set / delete のみ。
// あとで Firestore 同期に差し替えるときは、同じ形のオブジェクトを返す実装を用意して setBackend で入れ替える。

const DB_NAME = 'korean-cards';
const STORE = 'kv';

function idbBackend() {
  let dbp = null;
  const open = () => {
    dbp ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  };
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  return {
    get: (key) => run('readonly', (s) => s.get(key)),
    set: (key, value) => run('readwrite', (s) => s.put(value, key)).then(() => undefined),
    delete: (key) => run('readwrite', (s) => s.delete(key)).then(() => undefined),
  };
}

function memoryBackend() {
  const m = new Map();
  return {
    get: async (key) => structuredClone(m.get(key)),
    set: async (key, value) => void m.set(key, structuredClone(value)),
    delete: async (key) => void m.delete(key),
  };
}

let backend = typeof indexedDB !== 'undefined' ? idbBackend() : memoryBackend();

export const Store = {
  get: (key) => backend.get(key),
  set: (key, value) => backend.set(key, value),
  delete: (key) => backend.delete(key),
};

export function setBackend(b) {
  backend = b;
}

export { memoryBackend };
