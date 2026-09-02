import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import cors from '@fastify/cors';
import { readFileSync } from 'node:fs';
import { config } from './config.js';
import { openDb } from './db/index.js';
import authPlugin from './plugins/auth.js';
import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import libraryRoutes from './routes/library.js';
import streamRoutes from './routes/stream.js';
import adminRoutes from './routes/admin.js';
import healthRoutes from './routes/health.js';

export async function buildServer({ logger = true } = {}) {
  openDb();

  const https = config.tls.enabled
    ? { key: readFileSync(config.tls.keyPath), cert: readFileSync(config.tls.certPath) }
    : null;

  const app = Fastify({
    logger,
    https,
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,          // a login is small; nothing here needs megabytes
    disableRequestLogging: false
  });

  await app.register(cors, { origin: true, credentials: false });

  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.apiPerMinute,
    timeWindow: '1 minute',
    // Rate limit per device where we know it, per address otherwise, so one
    // television cannot lock out the rest of the house.
    keyGenerator: (request) => (request.headers.authorization || '') + '|' + request.ip
  });

  // Applied to the root instance rather than registered as a plugin: Fastify
  // encapsulates a plugin's decorators, and `authenticate` has to be visible
  // to every route that opts into it.
  await authPlugin(app);

  await app.register(healthRoutes, { prefix: '/api/v1' });
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(meRoutes, { prefix: '/api/v1/me' });
  await app.register(libraryRoutes, { prefix: '/api/v1' });
  await app.register(streamRoutes, { prefix: '/api/v1' });
  await app.register(adminRoutes, { prefix: '/api/v1/admin' });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    if (config.tls.enabled) reply.header('strict-transport-security', 'max-age=31536000');
    return payload;
  });

  return app;
}

// Started directly rather than imported by a test.
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildServer();
  try {
    await app.listen({ host: config.host, port: config.port });
    const scheme = config.tls.enabled ? 'https' : 'http';
    app.log.info(`Telly backend on ${scheme}://${config.host}:${config.port}/api/v1`);
    if (!config.tls.enabled) {
      app.log.warn('Serving plain HTTP. Fine on a home network; put TLS in front of it before it faces the internet.');
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
