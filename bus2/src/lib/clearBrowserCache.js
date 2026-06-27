const STORAGE_KEY = 'kerala-bus-state';

const IDB_NAME = 'kerala-bus-db';

const IDB_CLEAR_MS = 2000;



/** True when opened via run.bat / run.ps1 (?autofs=1). */

export function isScriptLaunch() {

  return new URLSearchParams(window.location.search).get('autofs') === '1';

}



function clearLocalStorage() {

  try {

    localStorage.removeItem(STORAGE_KEY);

  } catch {

    /* ignore */

  }

}



/** Drop stale IndexedDB copy (non-blocking; localStorage cleared in index.html). */

export function clearLaunchBrowserCache() {

  clearLocalStorage();



  if (typeof indexedDB === 'undefined') return Promise.resolve();



  return new Promise((resolve) => {

    let settled = false;

    const finish = () => {

      if (settled) return;

      settled = true;

      resolve();

    };



    const timer = window.setTimeout(finish, IDB_CLEAR_MS);



    try {

      const request = indexedDB.deleteDatabase(IDB_NAME);

      request.onsuccess = () => {

        window.clearTimeout(timer);

        finish();

      };

      request.onerror = () => {

        window.clearTimeout(timer);

        finish();

      };

      request.onblocked = () => {

        window.clearTimeout(timer);

        finish();

      };

    } catch {

      window.clearTimeout(timer);

      finish();

    }

  });

}


