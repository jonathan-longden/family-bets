import { findByAccess, isUsable } from '../services/sessions.js';
import { getUser, assertUsable, publicUser } from '../services/users.js';
import { touch } from '../services/devices.js';
import { ApiError, forbidden, sessionExpired } from '../lib/errors.js';

/**
 * Bearer authentication as a decorator rather than middleware on everything:
 * routes opt in with `preHandler: [app.authenticate]`, so a route that forgets
 * is a route that does not exist rather than a route that is open.
 */
export default async function authPlugin(app) {
  app.decorateRequest('auth', null);

  app.decorate('authenticate', async (request) => {
    const header = request.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (!/^Bearer$/i.test(scheme || '') || !token) throw sessionExpired();

    const session = findByAccess(token);
    if (!session) throw sessionExpired();

    // Account state is checked before session state on purpose. An account
    // that was disabled or has expired should say so, rather than sending the
    // app to a login screen that will fail again without explaining itself.
    const user = assertUsable(getUser(session.user_id));
    if (!isUsable(session)) throw sessionExpired();
    touch(session.device_id, request.ip);
    request.auth = { session, user, deviceId: session.device_id };
  });

  app.decorate('requireAdmin', async (request) => {
    if (!request.auth || request.auth.user.role !== 'admin')
      throw forbidden('That is an administrator action.');
  });

  app.decorate('publicUser', publicUser);

  // One error shape for everything, and never a stack trace on a television.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) return reply.status(error.status).send(error.toJSON());
    if (error.validation) {
      return reply.status(400).send({
        error: { code: 'bad_request', message: 'That request was not valid.', detail: error.message }
      });
    }
    if (error.statusCode === 429) {
      return reply.status(429).send({
        error: { code: 'rate_limited', message: 'Too many attempts. Wait a moment and try again.' }
      });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({
      error: { code: 'server_error', message: 'Something went wrong on the server.' }
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({ error: { code: 'not_found', message: 'No such endpoint.' } });
  });
}
