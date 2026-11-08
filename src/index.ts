import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildApp } from './app.ts';
import { openDb } from './db.ts';

const port = Number(process.env.PORT ?? 3000);
const baseUrl = (process.env.BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, '');
const dbPath = process.env.DB_PATH ?? './data/encurta.db';

const apiKey = process.env.API_KEY;
if (!apiKey) {
  console.error('Defina API_KEY (ex.: API_KEY=$(openssl rand -hex 16) npm start)');
  process.exit(1);
}

mkdirSync(dirname(dbPath), { recursive: true });
const app = buildApp(openDb(dbPath), {
  apiKey,
  baseUrl,
  ipSalt: process.env.IP_SALT ?? apiKey,
});

await app.listen({ port, host: process.env.HOST ?? '0.0.0.0' });
console.log(`encurta rodando em ${baseUrl}`);
