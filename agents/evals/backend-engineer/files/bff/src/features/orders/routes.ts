import type { FastifyPluginAsync } from 'fastify';
import type { CoreOrdersPort } from './ports/core-orders-port.js';

// Thin BFF feature: shapes one core-api call for the web client, no logic of its own.
export const ordersRoutes: FastifyPluginAsync<{ coreOrders: CoreOrdersPort }> = async (app, opts) => {
  app.get(
    '/orders/:orderId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['orderId'],
          properties: { orderId: { type: 'string' } },
          additionalProperties: false,
        },
        response: {
          200: {
            type: 'object',
            required: ['id', 'status', 'totalCents'],
            properties: {
              id: { type: 'string' },
              status: { type: 'string' },
              totalCents: { type: 'integer' },
            },
          },
        },
      },
    },
    async (request) => {
      const { orderId } = request.params as { orderId: string };
      const order = await opts.coreOrders.getOrder(orderId);
      return { id: order.id, status: order.status, totalCents: order.totalCents };
    },
  );
};
