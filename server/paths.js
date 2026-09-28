import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '..');

export function getBundledDataDirectory() {
  const localData = path.join(ROOT_DIR, 'data');
  if (fs.existsSync(path.join(localData, 'cr_database.json'))) {
    return localData;
  }
  if (process.resourcesPath) {
    const unpackedData = path.join(process.resourcesPath, 'app.asar.unpacked', 'data');
    if (fs.existsSync(path.join(unpackedData, 'cr_database.json'))) {
      return unpackedData;
    }
    const asarData = path.join(process.resourcesPath, 'app.asar', 'data');
    if (fs.existsSync(path.join(asarData, 'cr_database.json'))) {
      return asarData;
    }
  }
  return localData;
}
export const BUNDLED_DATA_DIR = getBundledDataDirectory();

export function getWritableDataDirectory() {
  if (process.env.USER_DATA_DIR) {
    const dir = path.join(process.env.USER_DATA_DIR, 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  
  if (process.resourcesPath) {
    const appData = process.env.APPDATA || (process.platform === 'darwin' 
      ? path.join(os.homedir(), 'Library', 'Application Support') 
      : path.join(os.homedir(), '.config'));
    const dir = path.join(appData, 'Mantis CR Ultra Hub', 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  const localDataDir = path.join(ROOT_DIR, 'data');
  if (!fs.existsSync(localDataDir)) fs.mkdirSync(localDataDir, { recursive: true });
  return localDataDir;
}

export const DATA_DIR = getWritableDataDirectory();
export const DB_FILE = path.join(DATA_DIR, 'cr_database.json');
export const META_FILE = path.join(DATA_DIR, 'cr_meta.json');
