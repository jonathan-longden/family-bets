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
 *   node bin/telly-admin.js probe <sourceId>        what an Xtream panel exposes
 *   node bin/telly-admin.js import-vod [sourceId]   its films and series
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
import { createSource, listSources, assign, syncSource, publicSource, getSource }
  from '../src/services/sources.js';
import { createRoot, listRoots, publicRoot, scanRoot, scanAll } from '../src/services/media.js';
import { ensureProviders } from '../src/services/providers/index.js';
import { syncLocalProvider, runImport } from '../src/services/importer.js';
import { providerByKey } from '../src/services/providers/index.js';
import { probeXtream } from '../src/services/xtream.js';
import { catalogueCounts } from '../src/services/catalogue.js';
import { createEpgSource, listEpgSources, publicEpgSource, syncEpgSource } from '../src/services/xmltv.js';
import { exportM3u } from '../src/services/library.js';

const [, , command, ...args] = process.argv;

/* A figure that may be null, because the panel refused that question. */
const fig = (n) => (n == null ? '—' : String(n));

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
  sync         <sourceId>            the live channels from one source
  probe        <sourceId>            what an Xtream panel actually exposes
  import-vod   [sourceId]            import an Xtream panel's films and series

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
      const id = Number(sourceId);
      const source = getSource(id);
      const result = await syncSource(id);
      console.log(`Synced ${result.channels} live channels at ${result.syncedAt}.`);
      /* Said out loud, because this is exactly what was confusing: a panel's
         films and series are a different catalogue behind the same API, and
         this command has only ever read the live one. */
      if (source.kind === 'xtream') {
        console.log('That is the live channel line-up only. For this panel\'s films and ' +
                    `series:  import-vod ${id}`);
        console.log(`To see what the panel exposes before importing:  probe ${id}`);
      }
      break;
    }

    /**
     * What one Xtream panel actually publishes.
     *
     * The answer to "it says 15 channels — is that everything?". It asks the
     * panel for each of its catalogue actions and reports what came back,
     * plus which metadata fields one film and one series actually carry on
     * this panel. Read-only: nothing is imported and nothing is written.
     */
    case 'probe': {
      const [sourceId] = args;
      if (!sourceId) usage(1);
      const source = getSource(Number(sourceId));
      if (source.kind !== 'xtream') {
        console.log(`Source ${source.id} ("${source.name}") is a ${source.kind} source. ` +
                    'Only an Xtream panel has a catalogue to probe.');
        break;
      }
      const got = await probeXtream({
        host: source.url, username: source.username, password: source.password
      });
      const c = got.counts;
      console.log(`${source.name} — ${got.host}`);
      console.log(`  account        ${got.account.username} · ${got.account.status || 'unknown'}` +
        (got.account.expiresAt ? ` · expires ${got.account.expiresAt.slice(0, 10)}` : '') +
        (got.account.maxConnections ? ` · ${got.account.maxConnections} connection(s)` : ''));
      console.log(`  output formats ${got.account.allowedOutputFormats.join(', ') || 'not stated'}`);
      console.log('');
      console.log(`  live channels  ${fig(c.liveStreams)} in ${fig(c.liveCategories)} categories` +
                  '   → Live TV');
      console.log(`  films          ${fig(c.vodStreams)} in ${fig(c.vodCategories)} categories` +
                  '   → Movies');
      console.log(`  series         ${fig(c.series)} in ${fig(c.seriesCategories)} categories` +
                  '   → Series');
      if (got.sampleMovie) {
        const h = got.sampleMovie.has;
        console.log('');
        console.log(`  a film:   "${got.sampleMovie.name}" (.${got.sampleMovie.container})`);
        console.log(`            carries ${Object.entries(h).filter(([, v]) => v)
          .map(([k]) => k).join(', ') || 'nothing but a name'}`);
        const missing = Object.entries(h).filter(([, v]) => !v).map(([k]) => k);
        if (missing.length) console.log(`            no ${missing.join(', ')}`);
      }
      if (got.sampleSeries) {
        console.log(`  a series: "${got.sampleSeries.name}" — ` +
          `${got.sampleSeries.seasons} season(s), ${got.sampleSeries.episodes} episode(s)`);
      }
      if (got.problems.length) {
        console.log('');
        console.log('  the panel did not answer these:');
        for (const p of got.problems) console.log(`    ${p}`);
      }
      console.log('');
      console.log(`  to import the films and series:  import-vod ${source.id}`);
      break;
    }

    /** Import the films and series of one panel, or of every enabled panel. */
    case 'import-vod': {
      const [sourceId] = args;
      /* As with `scan`: the provider rows are created on boot, and this tool
         may well be the first thing that ever runs against a new database. */
      ensureProviders();
      const provider = providerByKey('xtream');
      if (!provider) {
        console.log('The Xtream catalogue provider is not registered on this server.');
        process.exit(1);
      }
      if (sourceId) {
        const source = getSource(Number(sourceId));
        if (source.kind !== 'xtream') {
          console.log(`Source ${source.id} ("${source.name}") is a ${source.kind} source, ` +
                      'which has no films or series to import.');
          break;
        }
        if (!source.enabled) {
          console.log(`Source ${source.id} ("${source.name}") is switched off, so it is skipped.`);
          break;
        }
      }
      const got = await runImport(provider.id);
      const r = got.run || {};
      if (got.skipped) {
        console.log(`Skipped: ${got.reason}`);
        break;
      }
      console.log(`${r.status === 'done' ? 'Imported' : r.status}: ` +
        `${fig(r.moviesDiscovered)} films, ${fig(r.seriesDiscovered)} series, ` +
        `${fig(r.episodesDiscovered)} episodes · ${fig(r.newItems)} new, ` +
        `${fig(r.updatedItems)} updated, ${fig(r.duplicatesMerged)} merged with a title ` +
        'already in the catalogue.');
      if (r.errors) console.log(`${r.errors} record(s) could not be read.`);
      if (r.message) console.log(r.message);
      const counts = catalogueCounts();
      console.log(`The catalogue now holds ${counts.movies} films, ${counts.series} series ` +
        `and ${counts.episodes} episodes.`);
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
      /* The provider rows are the server's job on boot; the tool may be the
         first thing that ever runs, so it makes sure they exist before asking
         the local provider to publish anything. */
      ensureProviders();
      if (rootId) {
        const r = scanRoot(Number(rootId));
        console.log(`Scanned: ${r.found} files found, ${r.unmatched} not recognised, ` +
          `${r.missing} now missing, ${r.removed} dropped.`);
      } else {
        const { folders, totals } = scanAll({ kind: args[1] || 'all' });
        for (const r of folders) {
          console.log(r.error ? `  ${r.label}: ${r.error}`
            : `  ${r.label}: ${r.found} found, ${r.unmatched} not recognised, ${r.missing} now missing`);
        }
        console.log(`The library now holds ${totals.movies} films, ${totals.series} series ` +
          `(${totals.episodes} episodes) and ${totals.recordings} recordings. ` +
          `${totals.unmatched} file(s) could not be read; ${totals.errors} error(s).`);
      }
      /* And into the catalogue, which is what the apps read. */
      await syncLocalProvider();
      const c = catalogueCounts();
      console.log(`Catalogue: ${c.movies} films, ${c.series} series, ${c.episodes} episodes.`);
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
