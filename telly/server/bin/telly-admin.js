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
 *   node bin/telly-admin.js add-media <label> <movies|series|recordings> <folder>
 *   node bin/telly-admin.js scan [rootId]
 *   node bin/telly-admin.js add-epg <name> <xmltv url>
 *   node bin/telly-admin.js sync-epg <epgSourceId>
 *   node bin/telly-admin.js export [sourceId] > telly.m3u
 *   node bin/telly-admin.js list
 */
import { writeSync } from 'node:fs';
import { openDb } from '../src/db/index.js';
import { createUser, findByUsername, listUsers } from '../src/services/users.js';
import { createSource, listSources, assign, syncSource, publicSource } from '../src/services/sources.js';
import { createRoot, listRoots, publicRoot, scanRoot, scanAll } from '../src/services/media.js';
import { createEpgSource, listEpgSources, publicEpgSource, syncEpgSource } from '../src/services/xmltv.js';
import { exportM3u } from '../src/services/library.js';

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

  add-media    <label> <movies|series|recordings> <folder>
  scan         [rootId]            scan one media folder, or every one of them
  add-epg      <name> <xmltv url>
  sync-epg     <epgSourceId>
  export       [sourceId]          write an M3U of the catalogue to stdout

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
    case 'add-media': {
      const [label, kind, folder] = args;
      if (!label || !kind || !folder) usage(1);
      const r = createRoot({ label, kind, path: folder });
      console.log(`Media folder ${r.label} added (id ${r.id}). Run: scan ${r.id}`);
      break;
    }
    case 'scan': {
      const [rootId] = args;
      if (rootId) {
        const r = scanRoot(Number(rootId));
        console.log(`Scanned: ${r.found} files found, ${r.removed} gone.`);
      } else {
        for (const r of scanAll()) {
          console.log(r.error ? `  ${r.label}: ${r.error}` : `  ${r.label}: ${r.found} found, ${r.removed} gone`);
        }
      }
      break;
    }
    case 'add-epg': {
      const [name, url] = args;
      if (!name || !url) usage(1);
      const s = createEpgSource({ name, url });
      console.log(`Guide ${s.name} added (id ${s.id}). Run: sync-epg ${s.id}`);
      break;
    }
    case 'sync-epg': {
      const [id] = args;
      if (!id) usage(1);
      const r = await syncEpgSource(Number(id));
      console.log(`Guide loaded: ${r.channels} channels, ${r.programmes} programmes.`);
      break;
    }
    case 'export': {
      const [sourceId] = args;
      // Written to stdout so it can be redirected; it carries real addresses.
      writeSync(1, exportM3u({ sourceId: sourceId ? Number(sourceId) : null }));
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
          `${s.channelCount} channels${s.enabled ? '' : '  (off)'}${s.lastError ? '  ERROR: ' + s.lastError : ''}`);
      }
      const roots = listRoots().map(publicRoot);
      if (roots.length) {
        console.log('\nMedia folders:');
        for (const r of roots) {
          console.log(`  ${String(r.id).padStart(3)}  ${r.label.padEnd(20)} ${r.kind.padEnd(10)} ` +
            `${r.itemCount} items  ${r.path}${r.lastError ? '  ERROR: ' + r.lastError : ''}`);
        }
      }
      const guides = listEpgSources().map(publicEpgSource);
      if (guides.length) {
        console.log('\nGuides:');
        for (const g of guides) {
          console.log(`  ${String(g.id).padStart(3)}  ${g.name.padEnd(20)} ` +
            `${g.programmeCount} programmes${g.lastError ? '  ERROR: ' + g.lastError : ''}`);
        }
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
