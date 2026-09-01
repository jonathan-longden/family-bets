// The library's own decoder arithmetic, transcribed verbatim from the bundle.
function calculateMaxScores(data, numBoxes, numClasses) {
  const scores = [], classes = [];
  for (let w = 0; w < numBoxes; w++) {
    let best = Number.MIN_VALUE, bestIdx = -1;
    for (let a = 0; a < numClasses; a++) {
      const v = data[w * numClasses + (w + 1) * 4 + a];
      if (v > best) { best = v; bestIdx = a; }
    }
    scores[w] = best; classes[w] = bestIdx;
  }
  return { scores, classes };
}
function getBoxes(data, numBoxes, numClasses, size) {
  const out = [];
  for (let w = 0; w < numBoxes; w++) {
    const x = data[w * (numClasses + 4) + 0], y = data[w * (numClasses + 4) + 1];
    const bw = data[w * (numClasses + 4) + 2], bh = data[w * (numClasses + 4) + 3];
    out[w * 4] = (y - bh / 2) / size; out[w * 4 + 1] = (x - bw / 2) / size;
    out[w * 4 + 2] = (y + bh / 2) / size; out[w * 4 + 3] = (x + bw / 2) / size;
  }
  return out;
}
function transpose(flat, A, B) {           // [1,A,B] -> [1,B,A]
  const out = new Float32Array(A * B);
  for (let a = 0; a < A; a++) for (let b = 0; b < B; b++) out[b * A + a] = flat[a * B + b];
  return out;
}

const SIZE = 640, N = 8400, NC = 2;
// A believable raw YOLOv8/11 head: xywh in pixels, class scores after sigmoid.
function makeRaw(channelsFirst) {
  const A = channelsFirst ? 4 + NC : N, B = channelsFirst ? N : 4 + NC;
  const t = new Float32Array(A * B);
  const put = (box, ch, v) => { channelsFirst ? t[ch * N + box] = v : t[box * (4 + NC) + ch] = v; };
  for (let i = 0; i < N; i++) {
    put(i, 0, 40 + (i * 7) % 560);        // cx
    put(i, 1, 40 + (i * 13) % 560);       // cy
    put(i, 2, 20 + (i * 3) % 200);        // w
    put(i, 3, 20 + (i * 5) % 200);        // h
    put(i, 4, (i % 97) / 400);            // class 0 score, 0..0.24
    put(i, 5, i === 1234 ? 0.83 : (i % 53) / 300);   // class 1, one real hit
  }
  return { t, A, B };
}

const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };

function decode(raw) {
  const { t, A, B } = raw;
  const Sa = transpose(t, A, B);           // the library always transposes
  // transpose([0,2,1]) turns [1,A,B] into [1,B,A], so shape[1] is B and
  // shape[2] is A — the boxes come from the ORIGINAL last axis.
  const numBoxes = B, numClasses = A - 4;
  const { scores } = calculateMaxScores(Sa, numBoxes, numClasses);
  const boxes = getBoxes(Sa, numBoxes, numClasses, SIZE);
  const finite = scores.filter(Number.isFinite);
  return { numBoxes, numClasses,
           outOfRange: finite.filter(s => s > 1).length,
           total: finite.length,
           max: Math.max(...finite),
           firstBox: boxes.slice(0, 4) };
}

// YOLOv8 feeds the model NCHW and the export answers channels-first. The
// decoder was written for that pair and gets it right.
const first = decode(makeRaw(true));
console.log('   channels-first [1,6,8400] -> ' + first.numBoxes + ' boxes x ' +
            first.numClasses + ' classes, max score ' + first.max.toFixed(4));
ok(first.numBoxes === N && first.numClasses === NC,
   'a channels-first output decodes as ' + N + ' boxes and ' + NC + ' classes');
ok(first.outOfRange === 0, 'and every score lands inside 0..1');
ok(first.max > 0.8 && first.max <= 1, 'with the planted detection still the strongest');

// YOLOv11 in this library overrides only the input side — it feeds NHWC and
// inherits YOLOv8's channels-first output handling. An NHWC export answers
// channels-last, and the inherited decoder reads the axes the wrong way round.
const last = decode(makeRaw(false));
console.log('   channels-last  [1,8400,6] -> ' + last.numBoxes + ' boxes x ' +
            last.numClasses + ' classes, max score ' + last.max.toFixed(1));
ok(last.numBoxes === NC + 4 && last.numClasses === N - 4,
   'a channels-last output is read as ' + (NC + 4) + ' boxes and ' + (N - 4) + ' classes');
ok(last.outOfRange > 0, 'which puts scores outside 0..1 — what the field reports show');
ok(last.max > 100, 'by two or three orders of magnitude: ' + last.max.toFixed(1));
ok(last.firstBox.every(v => v > 0 && v < 1),
   'while the boxes still look plausible, which is why it was believed');

console.log(fails.length ? ('\n' + fails.length + ' FAILED') : '\nall passed');
process.exit(fails.length ? 1 : 0);
