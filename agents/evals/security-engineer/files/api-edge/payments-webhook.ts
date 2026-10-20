import type { FastifyInstance } from 'fastify';

interface PaymentEvent {
  type: 'payment.succeeded' | 'payment.failed';
  data: { orderId: string; amountCents: number };
}

export async function paymentsWebhookRoutes(app: FastifyInstance) {
  const orders = app.mongo.db.collection('orders');

  app.post('/webhooks/payments', async (request, reply) => {
    const event = request.body as PaymentEvent;

    if (event.type === 'payment.succeeded') {
      await orders.updateOne(
        { _id: event.data.orderId },
        { $set: { status: 'paid', paidCents: event.data.amountCents } },
      );
    }
    return reply.code(200).send({ received: true });
  });
}
