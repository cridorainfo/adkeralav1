import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** App code root (dist/, server/) — dev project root or Electron app.asar path. */
export function getAppRoot() {
  if (process.env.ADKERALA_APP_PATH) return process.env.ADKERALA_APP_PATH;
  if (process.env.ADKERALA_ROOT) return process.env.ADKERALA_ROOT;
  return path.join(__dirname, '..');
}

/** Writable data root (db/) — beside the portable EXE when packaged. */
export function getDataRoot() {
  if (process.env.ADKERALA_DATA_ROOT) return process.env.ADKERALA_DATA_ROOT;
  // electron-builder portable sets this to the folder containing AdKeralaDisplay.exe
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (process.env.ADKERALA_PACKAGED === '1') return path.dirname(process.execPath);
  return getAppRoot();
}

/** Copy bundled db template from Electron resources on first run. */
export function ensurePortableDb(dataRoot) {
  const infoFile = path.join(dataRoot, 'db', 'info.txt');
  if (fs.existsSync(infoFile)) return;

  const bundledDb = path.join(process.resourcesPath ?? '', 'db');
  if (!fs.existsSync(bundledDb)) return;

  fs.cpSync(bundledDb, path.join(dataRoot, 'db'), { recursive: true });
}
