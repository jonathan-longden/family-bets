import { openDb } from '../db/index.js';
import { config } from '../config.js';

/**
 * Unauthenticated on purpose, and deliberately dull: enough for the app's
 * "test connection" button to say yes, nothing that describes the machine.
 */
export default async function healthRoutes(app) {
  app.get('/health', async () => {
    const users = openDb().prepare('SELECT COUNT(*) AS n FROM users').get().n;
    return {
      ok: true,
      service: 'telly',
      api: 'v1',
      // Tells a fresh install whether anybody has set the server up yet.
      configured: users > 0,
      streamMode: config.streamMode
    };
  });
}
