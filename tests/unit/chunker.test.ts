import { describe, it, expect } from 'vitest';
import { planChunks, totalChunks } from '../../src/transfer/chunker.js';

describe('chunker', () => {
  it('returns empty plan for a 0-byte file', () => {
    expect(planChunks(0)).toEqual([]);
    expect(totalChunks(0)).toBe(0);
  });

  it('produces a single chunk for sizes <= chunkSize', () => {
    const plan = planChunks(100, 64);
    expect(plan).toHaveLength(2);
    expect(plan[0]).toEqual({ seq: 0, start: 0, end: 64, size: 64 });
    expect(plan[1]).toEqual({ seq: 1, start: 64, end: 100, size: 36 });
  });

  it('produces evenly-sized chunks when size is a multiple of chunkSize', () => {
    const plan = planChunks(192, 64);
    expect(plan).toHaveLength(3);
    expect(plan.map((c) => c.size)).toEqual([64, 64, 64]);
    expect(plan[2]!.end).toBe(192);
  });

  it('last chunk is shorter when there is a remainder', () => {
    const plan = planChunks(200, 64);
    expect(plan).toHaveLength(4);
    expect(plan[plan.length - 1]!.size).toBe(8);
    expect(plan[plan.length - 1]!.end).toBe(200);
  });

  it('seq numbers are contiguous starting at 0', () => {
    const plan = planChunks(1000, 100);
    for (let i = 0; i < plan.length; i++) {
      expect(plan[i]!.seq).toBe(i);
    }
  });

  it('totalChunks matches plan length for assorted sizes', () => {
    for (const size of [0, 1, 63, 64, 65, 127, 128, 129, 1023, 1024, 65_536]) {
      expect(totalChunks(size, 64)).toBe(planChunks(size, 64).length);
    }
  });

  it('rejects invalid sizes and chunk sizes', () => {
    expect(() => planChunks(-1)).toThrow();
    expect(() => planChunks(1.5)).toThrow();
    expect(() => planChunks(100, 0)).toThrow();
    expect(() => planChunks(100, -1)).toThrow();
  });
});
