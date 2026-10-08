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
    if (stat.size > 50 * 1024 * 1024) {
      throw new Error(`Cache file exceeds 50MB limit (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    parentPort.postMessage({ id, ok: true, parsed, sizeBytes: stat.size });
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: err.message });
  } finally {
    isProcessing = false;
    setImmediate(processNext);
  }
}

parentPort.on('message', (msg) => {
  queue.push(msg);
  processNext();
});

