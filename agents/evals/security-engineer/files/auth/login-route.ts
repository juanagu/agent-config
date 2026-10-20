import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';

export async function loginRoutes(app: FastifyInstance) {
  app.post('/login', async (request, reply) => {
    const { email, password } = request.body as any;

    const user = await app.mongo.db.collection('users').findOne({ email });
    if (!user) {
      return reply.code(404).send({ error: 'No account with that email' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return reply.code(401).send({ error: 'Wrong password' });
    }

    request.session.set('userId', String(user._id));
    return reply.code(200).send({ id: String(user._id), email: user.email });
  });
}
