const DATABASE_NAME = "rizu-windows-xp";
const STORE_NAME = "desktop-backgrounds";
const BACKGROUND_KEY = "custom";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open desktop background storage"));
  });
}

export async function loadDesktopBackground(): Promise<Blob | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(BACKGROUND_KEY);
      request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
      request.onerror = () => reject(request.error ?? new Error("Could not load the desktop background"));
    });
  } finally {
    database.close();
  }
}

export async function saveDesktopBackground(background: Blob): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(background, BACKGROUND_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save the desktop background"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Could not save the desktop background"));
    });
  } finally {
    database.close();
  }
}

export async function deleteDesktopBackground(): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(BACKGROUND_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not remove the desktop background"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Could not remove the desktop background"));
    });
  } finally {
    database.close();
  }
}
