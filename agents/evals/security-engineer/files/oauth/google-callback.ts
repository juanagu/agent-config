import type { FastifyInstance } from 'fastify';
import { exchangeCodeForProfile } from './google-client.js';

interface GoogleProfile {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
}

interface UserDoc {
  _id: string;
  email: string;
  isEmailVerified: boolean;
  googleSub?: string;
  name: string;
}

export async function googleCallbackRoutes(app: FastifyInstance) {
  const users = app.mongo.db.collection<UserDoc>('users');

  app.get('/auth/google/callback', async (request, reply) => {
    const requestId = Math.random().toString(36).slice(2);
    const { code } = request.query as { code: string };

    const profile: GoogleProfile = await exchangeCodeForProfile(code);
    request.log.info({ requestId, profile }, 'google sign-in');

    const existing = await users.findOne({ email: profile.email });
    if (existing) {
      await users.updateOne({ _id: existing._id }, { $set: { googleSub: profile.sub } });
      request.session.set('userId', existing._id);
      return reply.redirect('/');
    }

    const _id = crypto.randomUUID();
    await users.insertOne({
      _id,
      email: profile.email,
      isEmailVerified: profile.email_verified,
      googleSub: profile.sub,
      name: profile.name,
    });
    request.session.set('userId', _id);
    return reply.redirect('/');
  });
}
