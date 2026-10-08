import { parentPort } from 'worker_threads';
import fs from 'fs';

let isProcessing = false;
const queue = [];

function processNext() {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;
  const { id, filePath, diffData } = queue.shift();
  try {
    const jsonStr = JSON.stringify(diffData);
    fs.writeFileSync(filePath, jsonStr, 'utf8');
    parentPort.postMessage({ id, ok: true, sizeBytes: Buffer.byteLength(jsonStr, 'utf8') });
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: err.message });
  } finally {
    if (global.gc) {
      try { global.gc(); } catch (_) {}
    }
    isProcessing = false;
    setImmediate(processNext);
  }
}

parentPort.on('message', (msg) => {
  queue.push(msg);
  processNext();
});

