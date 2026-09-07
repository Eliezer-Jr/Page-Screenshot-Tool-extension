/**
 * Page Screenshot Tool
 * Copyright (c) 2026 ELIEZER MAWULI JUNIOR. All rights reserved.
 *
 * Storage blueprint: PNG Blob -> extension IndexedDB -> popup/preview page.
 * Screenshot data remains local and is never sent to an external service.
 */

const DATABASE_NAME = "page-screenshot-tool";
const STORE_NAME = "screenshots";
const LATEST_KEY = "latest";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, action) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

globalThis.ScreenshotStore = {
  save(record) {
    return withStore("readwrite", (store) => store.put(record, LATEST_KEY));
  },
  load() {
    return withStore("readonly", (store) => store.get(LATEST_KEY));
  },
  clear() {
    return withStore("readwrite", (store) => store.delete(LATEST_KEY));
  }
};
