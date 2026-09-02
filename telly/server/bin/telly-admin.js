#!/usr/bin/env node
/**
 * Setting the server up without a panel to click on.
 *
 *   node bin/telly-admin.js create-admin <username> <password>
 *   node bin/telly-admin.js add-user <username> <password> [maxDevices]
 *   node bin/telly-admin.js add-source <name> m3u_url <url>
 *   node bin/telly-admin.js add-source <name> xtream <host> <user> <pass>
 *   node bin/telly-admin.js assign <username> <sourceId>
 *   node bin/telly-admin.js sync <sourceId>
 *   node bin/telly-admin.js list
 */
import { openDb } from '../src/db/index.js';
import { createUser, findByUsername, listUsers } from '../src/services/users.js';
import { createSource, listSources, assign, syncSource, publicSource } from '../src/services/sources.js';

const [, , command, ...args] = process.argv;

function usage(code = 0) {
  console.log(readUsage());
  process.exit(code);
}
function readUsage() {
  return `Telly admin

  create-admin <username> <password>
  add-user     <username> <password> [maxDevices]
  add-source   <name> m3u_url <url>
  add-source   <name> xtream  <host> <username> <password>
  assign       <username> <sourceId>
  sync         <sourceId>
  list
`;
}

openDb();

try {
  switch (command) {
    case 'create-admin': {
      const [username, password] = args;
      if (!username || !password) usage(1);
      const u = await createUser({ username, password, role: 'admin' });
      console.log(`Administrator ${u.username} created (id ${u.id}).`);
      break;
    }
    case 'add-user': {
      const [username, password, maxDevices] = args;
      if (!username || !password) usage(1);
      const u = await createUser({ username, password, maxDevices: maxDevices ? Number(maxDevices) : undefined });
      console.log(`User ${u.username} created (id ${u.id}, ${u.max_devices} devices).`);
      break;
    }
    case 'add-source': {
      const [name, kind, ...rest] = args;
      if (!name || !kind) usage(1);
      const s = kind === 'xtream'
        ? createSource({ name, kind, url: rest[0], username: rest[1], password: rest[2] })
        : createSource({ name, kind, url: rest[0] });
      console.log(`Source ${s.name} created (id ${s.id}). Run: sync ${s.id}`);
      break;
    }
    case 'assign': {
      const [username, sourceId] = args;
      const user = findByUsername(username);
      if (!user) { console.error(`No user called ${username}.`); process.exit(1); }
      assign(user.id, Number(sourceId));
      console.log(`${username} can now see source ${sourceId}.`);
      break;
    }
    case 'sync': {
      const [sourceId] = args;
      const result = await syncSource(Number(sourceId));
      console.log(`Synced ${result.channels} channels at ${result.syncedAt}.`);
      break;
    }
    case 'list': {
      console.log('Users:');
      for (const u of listUsers()) {
        console.log(`  ${String(u.id).padStart(3)}  ${u.username.padEnd(20)} ${u.role.padEnd(6)} ` +
          `${u.enabled ? 'enabled ' : 'DISABLED'} devices:${u.max_devices}${u.expires_at ? ' expires:' + u.expires_at.slice(0, 10) : ''}`);
      }
      console.log('\nSources:');
      for (const s of listSources().map(publicSource)) {
        console.log(`  ${String(s.id).padStart(3)}  ${s.name.padEnd(20)} ${s.kind.padEnd(8)} ` +
          `${s.channelCount} channels${s.lastError ? '  ERROR: ' + s.lastError : ''}`);
      }
      break;
    }
    default:
      usage(command ? 1 : 0);
  }
} catch (e) {
  console.error(`Failed: ${e.message}`);
  process.exit(1);
}
