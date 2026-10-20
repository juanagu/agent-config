import type { FastifyPluginAsync } from 'fastify';
import { requireApiKey } from './auth/require-api-key.js';
import type { ExportJobs } from './ports/export-jobs.js';

// Auth: `x-api-key` header, checked by requireApiKey (401 { error: 'unauthorized' }).
export const exportRoutes: FastifyPluginAsync<{ jobs: ExportJobs }> = async (app, opts) => {
  app.post(
    '/v2/exports',
    {
      preHandler: requireApiKey,
      schema: {
        body: {
          type: 'object',
          required: ['projectId'],
          properties: {
            projectId: { type: 'string' },
            from: { type: 'string', format: 'date' },
            to: { type: 'string', format: 'date' },
          },
          additionalProperties: false,
        },
        response: {
          202: {
            type: 'object',
            required: ['id', 'status'],
            properties: { id: { type: 'string' }, status: { const: 'queued' } },
          },
        },
      },
    },
    async (request, reply) => {
      const job = await opts.jobs.enqueue(request.body as { projectId: string; from?: string; to?: string });
      return reply.code(202).send({ id: job.id, status: 'queued' });
    },
  );

  app.get(
    '/v2/exports/:id',
    {
      preHandler: requireApiKey,
      schema: {
        response: {
          200: {
            type: 'object',
            required: ['id', 'status'],
            properties: {
              id: { type: 'string' },
              status: { enum: ['queued', 'running', 'done', 'failed'] },
              downloadUrl: { type: 'string' },
            },
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const job = await opts.jobs.get(id); // throws NotFoundError -> 404 { error: 'not_found' }
      return { id: job.id, status: job.status, downloadUrl: job.downloadUrl };
    },
  );
};
