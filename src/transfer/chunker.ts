import { CHUNK_SIZE } from './protocol.js';

export interface PlannedChunk {
  seq: number;
  start: number;
  end: number; // exclusive
  size: number;
}

/**
 * Plan the chunks for a file of `size` bytes. Pure; takes no Blob/File. Useful for tests
 * and for the sender to drive its sliding window without re-reading the file repeatedly.
 */
export function planChunks(size: number, chunkSize = CHUNK_SIZE): PlannedChunk[] {
  if (size < 0 || !Number.isInteger(size)) throw new Error('size must be a non-negative integer');
  if (chunkSize <= 0) throw new Error('chunkSize must be > 0');
  if (size === 0) return [];
  const out: PlannedChunk[] = [];
  let seq = 0;
  for (let offset = 0; offset < size; offset += chunkSize, seq++) {
    const end = Math.min(offset + chunkSize, size);
    out.push({ seq, start: offset, end, size: end - offset });
  }
  return out;
}

export function totalChunks(size: number, chunkSize = CHUNK_SIZE): number {
  if (size === 0) return 0;
  return Math.ceil(size / chunkSize);
}
