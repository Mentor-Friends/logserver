import fs from 'fs';
import zlib from 'zlib';

export function readGzippedLogFile(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  const buffer = fs.readFileSync(filePath);
  const decompressed = zlib.gunzipSync(buffer).toString('utf8');
  return decompressed.split('\n').filter(line => line.trim());
}
