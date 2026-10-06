import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import cors from '@fastify/cors';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from './config.js';
import { openDb } from './db/index.js';
import authPlugin from './plugins/auth.js';
import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import libraryRoutes from './routes/library.js';
import streamRoutes from './routes/stream.js';
import catalogueRoutes from './routes/catalogue.js';
import unifiedCatalogueRoutes, { openArtworkRoutes } from './routes/catalogue-unified.js';
import adminRoutes from './routes/admin.js';
import healthRoutes from './routes/health.js';
import appRoutes from './routes/app.js';
import compatRoutes from './routes/compat.js';
import { startScheduler } from './services/scheduler.js';
import { ensureProviders } from './services/providers/index.js';

export async function buildServer({ logger = true } = {}) {
  openDb();
  /* The adapters are the source of truth for what each provider permits, so
     their assessments are written through on every boot — a new adapter
     appears, and a changed assessment takes effect, without disturbing the
     switches or the history an operator owns. */
  ensureProviders();

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
  await app.register(catalogueRoutes, { prefix: '/api/v1' });
  await app.register(unifiedCatalogueRoutes, { prefix: '/api/v1' });
  /* Pictures, which an <img> fetches with no header: registered as their own
     plugin so the authenticate hook inside the one above does not apply.
     The address carries a signature instead — see artSignature. */
  await app.register(openArtworkRoutes, { prefix: '/api/v1' });
  await app.register(streamRoutes, { prefix: '/api/v1' });
  await app.register(adminRoutes, { prefix: '/api/v1/admin' });
  /* The short, unversioned paths, pointing at the catalogue. */
  await app.register(compatRoutes, { prefix: '/api' });
  /* Last, so nothing it serves can shadow an API route. */
  await app.register(appRoutes);

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    if (config.tls.enabled) reply.header('strict-transport-security', 'max-age=31536000');
    return payload;
  });

  return app;
}

/**
 * Was this module run directly, or imported by something else?
 *
 * `import.meta.url` is a file:// URL; `process.argv[1]` is a filesystem path
 * in the platform's own spelling. Those are different kinds of string, so they
 * have to be converted before they are compared — not concatenated.
 *
 * This used to read `import.meta.url === \`file://${process.argv[1]}\``, which
 * matched on Linux and macOS purely by luck: an absolute POSIX path starts
 * with a slash, so "file://" + "/srv/app.js" happens to spell the same
 * three-slash URL that Node produces. On Windows there is no leading slash and
 * the separators are backslashes:
 *
 *     argv[1]          C:\Telly\server\src\index.js
 *     import.meta.url  file:///C:/Telly/server/src/index.js
 *     the old check    file://C:\Telly\server\src\index.js   — never equal
 *
 * So the condition was always false, nothing called listen(), and `npm start`
 * exited silently with status 0 — no error, because nothing had gone wrong as
 * far as Node was concerned. There was simply no work left to do.
 *
 * `pathToFileURL` does the conversion properly on every platform: it picks the
 * right separators, adds the slash Windows drive letters need, and
 * percent-encodes what has to be encoded. The realpath comparison is a second
 * chance for the cases a string comparison cannot see — a symlinked checkout,
 * or a path reached through a junction — and is allowed to fail quietly,
 * because by then the straightforward answer has already been given.
 */
export function isEntryPoint(moduleUrl, argvPath = process.argv[1]) {
  if (!moduleUrl || !argvPath) return false;
  try {
    if (pathToFileURL(argvPath).href === moduleUrl) return true;
  } catch {
    return false;                        // not a path this platform can spell
  }
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argvPath);
  } catch {
    return false;                        // one of them is not on disk
  }
}

// Started directly rather than imported by a test.
if (isEntryPoint(import.meta.url)) {
  const app = await buildServer();
  // Playlists, guides and media folders refresh on their own intervals. Only
  // the real server does this: a test drives runOnce() itself.
  startScheduler(app);
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
