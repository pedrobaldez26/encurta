import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db.ts';
import { isValidCustomSlug, randomSlug } from './slug.ts';
import { checkTargetUrl } from './url.ts';
import { browserFamily, referrerHost } from './ua.ts';

export interface AppOptions {
  apiKey: string;
  baseUrl: string; // ex.: http://localhost:3000
  ipSalt: string;
}

interface LinkRow {
  slug: string;
  url: string;
  expires_at: string | null;
  created_at: string;
}

const createBody = {
  type: 'object',
  required: ['url'],
  additionalProperties: false,
  properties: {
    url: { type: 'string', minLength: 1 },
    slug: { type: 'string' },
    expiresAt: { type: 'string', format: 'date-time' },
  },
} as const;

function sameSecret(a: string, b: string) {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function buildApp(db: Db, opts: AppOptions) {
  const app = Fastify({ logger: false, trustProxy: true });
  const ownHost = new URL(opts.baseUrl).host;
  const dashboard = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

  const requireKey = async (req: FastifyRequest, reply: FastifyReply) => {
    const key = req.headers['x-api-key'];
    if (typeof key !== 'string' || !sameSecret(key, opts.apiKey)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  };

  app.get('/healthz', async () => ({ ok: true }));

  app.get('/', async (_req, reply) => reply.type('text/html; charset=utf-8').send(dashboard));

  app.post('/api/links', { schema: { body: createBody }, preHandler: requireKey }, async (req, reply) => {
    const body = req.body as { url: string; slug?: string; expiresAt?: string };

    const target = checkTargetUrl(body.url, ownHost);
    if (!target.ok) return reply.code(400).send({ error: target.reason });

    if (body.expiresAt && Date.parse(body.expiresAt) <= Date.now()) {
      return reply.code(400).send({ error: 'expires_in_the_past' });
    }

    const insert = db.prepare('INSERT INTO links (slug, url, expires_at) VALUES (?, ?, ?)');
    let slug = body.slug;

    if (slug !== undefined) {
      if (!isValidCustomSlug(slug)) return reply.code(400).send({ error: 'invalid_slug' });
      try {
        insert.run(slug, target.url, body.expiresAt ?? null);
      } catch {
        return reply.code(409).send({ error: 'slug_taken' });
      }
    } else {
      // colisão com 62^7 combinações é rara, mas tenta de novo algumas vezes
      for (let attempt = 0; attempt < 5; attempt++) {
        slug = randomSlug();
        try {
          insert.run(slug, target.url, body.expiresAt ?? null);
          break;
        } catch {
          slug = undefined;
        }
      }
      if (!slug) return reply.code(503).send({ error: 'could_not_allocate_slug' });
    }

    return reply.code(201).send({ slug, url: target.url, shortUrl: `${opts.baseUrl}/${slug}` });
  });

  app.get('/api/links', { preHandler: requireKey }, async () => {
    const rows = db
      .prepare(
        `SELECT l.slug, l.url, l.expires_at, l.created_at, COUNT(c.id) AS clicks
         FROM links l LEFT JOIN clicks c ON c.slug = l.slug
         GROUP BY l.slug ORDER BY l.created_at DESC LIMIT 100`,
      )
      .all() as unknown as (LinkRow & { clicks: number })[];

    return rows.map((r) => ({
      slug: r.slug,
      url: r.url,
      shortUrl: `${opts.baseUrl}/${r.slug}`,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
      clicks: r.clicks,
    }));
  });

  app.get<{ Params: { slug: string } }>('/api/links/:slug/stats', { preHandler: requireKey }, async (req, reply) => {
    const { slug } = req.params;
    const link = db.prepare('SELECT * FROM links WHERE slug = ?').get(slug) as unknown as LinkRow | undefined;
    if (!link) return reply.code(404).send({ error: 'not_found' });

    const totals = db
      .prepare('SELECT COUNT(*) AS total, COUNT(DISTINCT visitor_hash) AS uniq FROM clicks WHERE slug = ?')
      .get(slug) as unknown as { total: number; uniq: number };

    const byDay = db
      .prepare(
        `SELECT substr(clicked_at, 1, 10) AS day, COUNT(*) AS clicks FROM clicks
         WHERE slug = ? AND clicked_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
         GROUP BY day ORDER BY day`,
      )
      .all(slug);

    const byReferrer = db
      .prepare(
        `SELECT COALESCE(referrer, '(direto)') AS referrer, COUNT(*) AS clicks FROM clicks
         WHERE slug = ? GROUP BY referrer ORDER BY clicks DESC LIMIT 10`,
      )
      .all(slug);

    const byBrowser = db
      .prepare('SELECT browser, COUNT(*) AS clicks FROM clicks WHERE slug = ? GROUP BY browser ORDER BY clicks DESC')
      .all(slug);

    return {
      slug,
      url: link.url,
      total: totals.total,
      unique: totals.uniq,
      byDay,
      byReferrer,
      byBrowser,
    };
  });

  app.delete<{ Params: { slug: string } }>('/api/links/:slug', { preHandler: requireKey }, async (req, reply) => {
    const result = db.prepare('DELETE FROM links WHERE slug = ?').run(req.params.slug);
    if (result.changes === 0) return reply.code(404).send({ error: 'not_found' });
    return reply.code(204).send();
  });

  // Fica por último para não engolir as rotas acima.
  app.get<{ Params: { slug: string } }>('/:slug', async (req, reply) => {
    const link = db.prepare('SELECT * FROM links WHERE slug = ?').get(req.params.slug) as unknown as
      | LinkRow
      | undefined;
    if (!link) return reply.code(404).type('text/plain').send('Link não encontrado');

    if (link.expires_at && Date.parse(link.expires_at) <= Date.now()) {
      return reply.code(410).type('text/plain').send('Esse link expirou');
    }

    // Não guardamos o IP: só um hash com sal, suficiente para contar visitantes únicos.
    const visitor = createHash('sha256')
      .update(`${opts.ipSalt}|${req.ip}|${req.headers['user-agent'] ?? ''}`)
      .digest('hex')
      .slice(0, 16);

    db.prepare('INSERT INTO clicks (slug, referrer, browser, visitor_hash) VALUES (?, ?, ?, ?)').run(
      link.slug,
      referrerHost(req.headers.referer),
      browserFamily(req.headers['user-agent']),
      visitor,
    );

    return reply.redirect(link.url, 302);
  });

  return app;
}
