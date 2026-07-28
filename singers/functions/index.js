/* Transcode uploaded clips to H.264 MP4 so they play everywhere.
 *
 * WHY: Chrome records WebM, iOS Safari records MP4, and a clip is stored in
 * whatever format it was recorded in. Once clips sync between phones, roughly
 * half of cross-platform playbacks fail. Transcoding on upload fixes that and
 * shrinks the files, which also eases the download quota.
 *
 * STATUS: written against the documented APIs but NOT deployed or run — the
 * environment this was built in has no Firebase project. Treat it as a
 * starting point and test it on a throwaway project first. See README.md here.
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const ffmpegPath = require('ffmpeg-static');
const { spawn } = require('child_process');
const { tmpdir } = require('os');
const path = require('path');
const fs = require('fs');

admin.initializeApp();

const BOARD_PATH = 'spotlightBoard';

exports.transcodeClip = functions
  .runWith({ memory: '2GB', timeoutSeconds: 540 })
  .storage.object()
  .onFinalize(async object => {
    const filePath = object.name || '';
    const contentType = object.contentType || '';

    if (!filePath.startsWith('clips/')) return null;
    if (!contentType.startsWith('video/')) return null;
    if (filePath.endsWith('.mp4')) return null;              // already playable everywhere
    if (object.metadata && object.metadata.transcoded) return null;

    const bucket = admin.storage().bucket(object.bucket);
    const clipId = path.basename(filePath).replace(/\.[^.]+$/, '');
    const localIn = path.join(tmpdir(), path.basename(filePath));
    const localOut = path.join(tmpdir(), `${clipId}.mp4`);

    await bucket.file(filePath).download({ destination: localIn });

    await new Promise((resolve, reject) => {
      const args = [
        '-i', localIn,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
        '-profile:v', 'baseline', '-level', '3.1',            // maximum device compatibility
        '-vf', 'scale=trunc(min(1080,iw)/2)*2:trunc(ow/a/2)*2',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',                            // start playing before fully loaded
        '-y', localOut,
      ];
      const proc = spawn(ffmpegPath, args);
      let stderr = '';
      proc.stderr.on('data', d => { stderr += d.toString().slice(-2000); });
      proc.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg ' + code + ': ' + stderr)));
      proc.on('error', reject);
    });

    const destPath = `clips/${clipId}.mp4`;
    await bucket.upload(localOut, {
      destination: destPath,
      metadata: { contentType: 'video/mp4', metadata: { transcoded: 'true', source: filePath } },
    });

    const [url] = await bucket.file(destPath).getSignedUrl({ action: 'read', expires: '2100-01-01' });

    // Point the clip record at the MP4 so every device plays the same file.
    const clipRef = admin.database().ref(`${BOARD_PATH}/clips/${clipId}`);
    const snap = await clipRef.once('value');
    if (snap.exists()) {
      await clipRef.update({ videoUrl: url, videoType: 'video/mp4', updatedAt: Date.now() });
    }

    await bucket.file(filePath).delete().catch(() => {});     // drop the original
    fs.unlink(localIn, () => {});
    fs.unlink(localOut, () => {});
    return null;
  });
