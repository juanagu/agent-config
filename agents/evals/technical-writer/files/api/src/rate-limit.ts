import type { FastifyInstance } from 'fastify';

const LIMIT_PER_WINDOW = 60;
const WINDOW_MS = 60_000;

const counters = new Map<string, { count: number; resetAt: number }>();

// Limits requests per client IP, in a fixed one-minute window.
export async function rateLimit(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    const now = Date.now();
    const entry = counters.get(request.ip);

    if (!entry || entry.resetAt <= now) {
      counters.set(request.ip, { count: 1, resetAt: now + WINDOW_MS });
      return;
    }

    entry.count += 1;
    if (entry.count > LIMIT_PER_WINDOW) {
      return reply.code(429).send({ error: 'rate_limited' });
    }
  });
}
