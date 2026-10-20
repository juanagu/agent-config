import type { FastifyInstance } from 'fastify';

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, { count: number; resetAt: number }>();

// We sit behind Cloudflare, which sets this header to the real client IP.
export async function loginRateLimit(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    if (request.url !== '/auth/login') return;

    const ip = (request.headers['cf-connecting-ip'] as string) ?? request.ip;
    const now = Date.now();
    const entry = hits.get(ip);
    if (!entry || entry.resetAt < now) {
      hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
      return;
    }
    entry.count += 1;
    if (entry.count > MAX_PER_WINDOW) {
      return reply.code(429).send({ error: 'rate_limited' });
    }
  });
}
