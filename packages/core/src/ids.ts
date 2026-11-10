import { z } from 'zod';

// Shared id format so the API and an offline client mint ids the same way.
// The client must generate ids for rows it creates offline (so it can refer
// to them before they are uploaded), so this lives in core, not the API.
export const ID_PATTERN = /^[a-z]{2,5}_[0-9a-f]{24}$/;
export const IdSchema = z.string().regex(ID_PATTERN);

export function newId(prefix: string): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return `${prefix}_${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}
