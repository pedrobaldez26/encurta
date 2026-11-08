import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { openDb, type Db } from '../src/db.ts';

const headers = { 'x-api-key': 'chave-de-teste' };
let app: ReturnType<typeof buildApp>;
let db: Db;

beforeEach(() => {
  db = openDb();
  app = buildApp(db, { apiKey: 'chave-de-teste', baseUrl: 'http://localhost:3000', ipSalt: 'sal' });
});

async function create(payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/links', headers, payload });
}

test('criar exige a API key', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/links', payload: { url: 'https://example.com' } });
  assert.equal(res.statusCode, 401);
});

test('cria link com slug aleatório e redireciona', async () => {
  const created = await create({ url: 'https://example.com/pagina?a=1' });
  assert.equal(created.statusCode, 201);
  const { slug, shortUrl } = created.json();
  assert.match(slug, /^[0-9a-zA-Z]{7}$/);
  assert.equal(shortUrl, `http://localhost:3000/${slug}`);

  const res = await app.inject({ method: 'GET', url: `/${slug}` });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, 'https://example.com/pagina?a=1');
});

test('slug personalizado: aceita, recusa duplicado e reservado', async () => {
  assert.equal((await create({ url: 'https://example.com', slug: 'promo-natal' })).statusCode, 201);
  assert.equal((await create({ url: 'https://example.org', slug: 'promo-natal' })).statusCode, 409);
  assert.equal((await create({ url: 'https://example.org', slug: 'api' })).statusCode, 400);
  assert.equal((await create({ url: 'https://example.org', slug: 'a b' })).statusCode, 400);
});

test('recusa destinos perigosos ou inválidos', async () => {
  for (const url of [
    'javascript:alert(1)',
    'ftp://example.com/arquivo',
    'não é url',
    'https://user:senha@example.com',
    'http://localhost:3000/abc',
  ]) {
    const res = await create({ url });
    assert.equal(res.statusCode, 400, url);
  }
});

test('link expirado responde 410 e não conta clique', async () => {
  const { slug } = (await create({ url: 'https://example.com', expiresAt: new Date(Date.now() + 60_000).toISOString() })).json();
  assert.equal((await app.inject({ method: 'GET', url: `/${slug}` })).statusCode, 302);

  db.prepare("UPDATE links SET expires_at = '2020-01-01T00:00:00.000Z' WHERE slug = ?").run(slug);
  assert.equal((await app.inject({ method: 'GET', url: `/${slug}` })).statusCode, 410);

  const stats = (await app.inject({ method: 'GET', url: `/api/links/${slug}/stats`, headers })).json();
  assert.equal(stats.total, 1); // só o clique de antes de expirar
});

test('não aceita data de expiração no passado', async () => {
  const res = await create({ url: 'https://example.com', expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(res.statusCode, 400);
});

test('estatísticas contam cliques, únicos, origem e navegador', async () => {
  const { slug } = (await create({ url: 'https://example.com' })).json();
  const chrome = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';
  const firefox = 'Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/121.0';

  await app.inject({ method: 'GET', url: `/${slug}`, headers: { 'user-agent': chrome, referer: 'https://news.ycombinator.com/item?id=1' }, remoteAddress: '10.0.0.1' });
  await app.inject({ method: 'GET', url: `/${slug}`, headers: { 'user-agent': chrome }, remoteAddress: '10.0.0.1' });
  await app.inject({ method: 'GET', url: `/${slug}`, headers: { 'user-agent': firefox }, remoteAddress: '10.0.0.2' });

  const res = await app.inject({ method: 'GET', url: `/api/links/${slug}/stats`, headers });
  assert.equal(res.statusCode, 200);
  const stats = res.json();
  assert.equal(stats.total, 3);
  assert.equal(stats.unique, 2);
  assert.deepEqual(
    stats.byBrowser.map((b: { browser: string; clicks: number }) => [b.browser, b.clicks]),
    [['Chrome', 2], ['Firefox', 1]],
  );
  assert.ok(stats.byReferrer.some((r: { referrer: string }) => r.referrer === 'news.ycombinator.com'));
  assert.equal(stats.byDay.length, 1);
});

test('slug inexistente dá 404 e apagar remove também os cliques', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/naoexiste' })).statusCode, 404);

  const { slug } = (await create({ url: 'https://example.com' })).json();
  await app.inject({ method: 'GET', url: `/${slug}` });
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/links/${slug}`, headers })).statusCode, 204);
  assert.equal((await app.inject({ method: 'GET', url: `/${slug}` })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: `/api/links/${slug}/stats`, headers })).statusCode, 404);
});
