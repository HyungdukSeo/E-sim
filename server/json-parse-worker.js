import { parentPort } from 'worker_threads';
import fs from 'fs';

let isProcessing = false;
const queue = [];

function processNext() {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;
  const { id, filePath } = queue.shift();
  try {
    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    parentPort.postMessage({ id, ok: true, parsed, sizeBytes: stat.size });
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

