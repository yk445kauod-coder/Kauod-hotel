import { describe, it, expect } from 'vitest';
import { newId, IdSchema } from '../src/index.js';

describe('newId', () => {
  it('matches the id pattern and is unique', () => {
    const a = newId('room');
    const b = newId('room');
    expect(IdSchema.safeParse(a).success).toBe(true);
    expect(a).not.toBe(b);
  });
});
