import fs from 'fs';
import zlib from 'zlib';
import path from 'path';

export function rotateAndCompressLogFile(logFilePath: string, maxSizeBytes: number = 10 * 1024 * 1024) {
  if (!fs.existsSync(logFilePath)) return;
  const stats = fs.statSync(logFilePath);
  if (stats.size < maxSizeBytes) return;

  // Find next available .gz name
  let idx = 1;
  let gzPath = logFilePath + `.gz`;
  while (fs.existsSync(gzPath)) {
    idx++;
    gzPath = logFilePath + `.${idx}.gz`;
  }

  // Compress and rotate
  const input = fs.readFileSync(logFilePath);
  const compressed = zlib.gzipSync(input);
  fs.writeFileSync(gzPath, compressed);
  fs.truncateSync(logFilePath, 0); // Clear the original log
}
