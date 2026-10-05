import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/**
 * Serving the app itself.
 *
 * The catalogue lives in SQLite on this machine, so the app has to be able to
 * reach this machine. Opening the app from a static host over https and
 * pointing it at http://192.168.1.50:8080 does not work and cannot be made to
 * work from this side: the browser refuses the request as mixed content before
 * it reaches the network.
 *
 * So the server offers the app at its own address. Browser and API then share
 * an origin, which removes the mixed-content problem and the CORS question in
 * one go — no certificate, no proxy, no configuration:
 *
 *     http://192.168.1.50:8080/
 *     http://192.168.1.50:8080/telly/
 *
 * A static host stays useful as a shop window, but the live library needs the
 * server, and this is the supported way to have it.
 *
 * Only a named list of files is served, from one directory, resolved and
 * checked — the same rule the media folders follow. There is no directory
 * listing and no way to ask for anything else.
 */

/* The app is one HTML file plus the bits a browser asks for around it. */
const FILES = {
  'index.html': 'text/html; charset=utf-8',
  'manifest.webmanifest': 'application/manifest+json',
  'icon.svg': 'image/svg+xml',
  'icon-maskable.svg': 'image/svg+xml',
  'sw.js': 'text/javascript; charset=utf-8'
};

export default async function appRoutes(app) {
  if (!config.app.serve) return;
  const dir = path.resolve(config.app.dir);

  const send = (name) => async (request, reply) => {
    const file = path.resolve(path.join(dir, name));
    /* Resolved and bounded, so a name can never climb out of the directory
       even if this list grew a mistake in it. */
    if (file !== dir && !file.startsWith(dir + path.sep)) {
      return reply.status(404).send({ error: { code: 'not_found', message: 'No such file.' } });
    }
    if (!existsSync(file)) {
      return reply.status(404).send({
        error: {
          code: 'app_not_found',
          message: `The app was not found at ${dir}. Set TELLY_APP_DIR to the folder holding ` +
            'index.html, or TELLY_SERVE_APP=false to turn this off.'
        }
      });
    }
    reply.header('content-type', FILES[name]);
    /* The app is one file that changes when it changes; revalidating costs a
       round trip and saves serving it again. */
    reply.header('cache-control', 'no-cache');
    reply.header('last-modified', statSync(file).mtime.toUTCString());
    return reply.send(createReadStream(file));
  };

  /* Both, because both are natural things to type, and /telly/ is what the
     documentation says. */
  app.get('/', send('index.html'));
  app.get('/telly', async (_q, reply) => reply.redirect(302, '/telly/'));
  app.get('/telly/', send('index.html'));

  for (const name of Object.keys(FILES)) {
    app.get(`/${name}`, send(name));
    app.get(`/telly/${name}`, send(name));
  }
}
