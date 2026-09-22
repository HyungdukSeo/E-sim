// Dedicated worker thread for parsing large diff-cache JSON files off the
// main event loop. A single large CR's cache (release-style check-ins with
// 1000+ files, each carrying a full unified diff) can reach several hundred
// MB; JSON.parse on a string that size is a multi-second synchronous CPU
// operation that would otherwise stall every other request the server is
// handling for that whole time, no matter how the file I/O itself is done.
import { parentPort } from 'worker_threads';
import fs from 'fs';

parentPort.on('message', ({ id, filePath }) => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    parentPort.postMessage({ id, ok: true, parsed, sizeBytes: Buffer.byteLength(content, 'utf8') });
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: err.message });
  }
});
