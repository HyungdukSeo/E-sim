// Dedicated worker thread for JSON.stringify + disk write of large
// diff-cache payloads. Once a CR's cache reaches hundreds of files (each
// carrying a full unified diff), JSON.stringify on the whole payload is a
// multi-second synchronous CPU operation — doing it on the main thread would
// undo the benefit of parsing large caches off-thread on the read side.
import { parentPort } from 'worker_threads';
import fs from 'fs';

parentPort.on('message', ({ id, filePath, diffData }) => {
  try {
    const jsonStr = JSON.stringify(diffData);
    fs.writeFileSync(filePath, jsonStr, 'utf8');
    parentPort.postMessage({ id, ok: true, sizeBytes: Buffer.byteLength(jsonStr, 'utf8') });
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: err.message });
  }
});
