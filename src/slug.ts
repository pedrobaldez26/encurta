import { randomInt } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function randomSlug(length = 7): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

// Rotas que a própria aplicação usa e não podem virar slug.
const RESERVED = new Set(['api', 'healthz', 'favicon.ico', 'robots.txt']);

export function isValidCustomSlug(slug: string): boolean {
  return /^[a-zA-Z0-9_-]{3,32}$/.test(slug) && !RESERVED.has(slug.toLowerCase());
}
