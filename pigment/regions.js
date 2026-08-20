/* Pigment — turning a grid of numbers into a picture with outlines.

   A colour-by-number picture isn't really a grid of numbered squares: it's
   areas of flat colour, each drawn with an outline and carrying one number.
   This file takes the grid a picture is built from and works out those
   areas — where they are, what shape their edges are, and where the number
   should sit so it lands inside its own area.

   Nothing here touches the DOM: it runs the same in a page or in a test. */
(() => {
  'use strict';

  const NONE = -1;

  // ---------------------------------------------------------- components

  /* Label every run of touching squares of the same colour. Squares that
     touch only at a corner belong to different areas — a person colouring
     in would read a diagonal join as two shapes, not one. */
  function label(cells, cols, rows) {
    const labels = new Int32Array(cols * rows).fill(NONE);
    const areas = [];
    const colours = [];
    const stack = new Int32Array(cols * rows);

    for (let start = 0; start < cells.length; start++) {
      if (labels[start] !== NONE || !cells[start]) continue;
      const colour = cells[start];
      const id = areas.length;
      areas.push(0);
      colours.push(colour);

      let top = 0;
      stack[top++] = start;
      labels[start] = id;
      while (top > 0) {
        const i = stack[--top];
        areas[id]++;
        const x = i % cols, y = (i - (i % cols)) / cols;
        if (x > 0 && labels[i - 1] === NONE && cells[i - 1] === colour) { labels[i - 1] = id; stack[top++] = i - 1; }
        if (x < cols - 1 && labels[i + 1] === NONE && cells[i + 1] === colour) { labels[i + 1] = id; stack[top++] = i + 1; }
        if (y > 0 && labels[i - cols] === NONE && cells[i - cols] === colour) { labels[i - cols] = id; stack[top++] = i - cols; }
        if (y < rows - 1 && labels[i + cols] === NONE && cells[i + cols] === colour) { labels[i + cols] = id; stack[top++] = i + cols; }
      }
    }

    return { labels, areas, colours };
  }

  /* Areas too small to hold a number are no fun to colour and clutter the
     outlines, so each one is given to whichever neighbour it shares the most
     edge with. Merging changes colours, which can join areas that were
     previously apart, so this runs until nothing more moves. */
  function absorbSmall(cells, cols, rows, minArea, minRoom) {
    for (let pass = 0; pass < 10; pass++) {
      const { labels, areas } = label(cells, cols, rows);
      const small = [];
      const boxes = boxesOf(labels, areas.length, cols, rows);
      for (let id = 0; id < areas.length; id++) {
        if (areas[id] < minArea) { small.push(id); continue; }
        /* Area alone isn't enough: a one-square-wide ring around an eye can
           be large and still be a sliver nobody can see, let alone colour.
           Anything with no room in the middle of it goes as well. */
        if (minRoom > 0 && labelPoint(labels, cols, rows, id, boxes[id]).room < minRoom) small.push(id);
      }
      if (!small.length) return;

      // how much edge each small area shares with each of its neighbours
      const shared = new Map();
      const note = (id, other) => {
        let row = shared.get(id);
        if (!row) { row = new Map(); shared.set(id, row); }
        row.set(other, (row.get(other) || 0) + 1);
      };
      const wanted = new Set(small);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          const id = labels[i];
          if (id === NONE) continue;
          if (x < cols - 1) {
            const right = labels[i + 1];
            if (right !== NONE && right !== id) {
              if (wanted.has(id)) note(id, right);
              if (wanted.has(right)) note(right, id);
            }
          }
          if (y < rows - 1) {
            const below = labels[i + cols];
            if (below !== NONE && below !== id) {
              if (wanted.has(id)) note(id, below);
              if (wanted.has(below)) note(below, id);
            }
          }
        }
      }

      // smallest first, so a speck joins a real area rather than another speck
      small.sort((a, b) => areas[a] - areas[b]);
      const newColour = new Map();
      for (const id of small) {
        const row = shared.get(id);
        if (!row) continue;
        let best = NONE, bestShare = -1, bestArea = -1;
        for (const [other, share] of row) {
          if (share > bestShare || (share === bestShare && areas[other] > bestArea)) {
            best = other; bestShare = share; bestArea = areas[other];
          }
        }
        if (best !== NONE) newColour.set(id, best);
      }
      if (!newColour.size) return;

      let moved = false;
      for (let i = 0; i < cells.length; i++) {
        const id = labels[i];
        if (id === NONE) continue;
        const into = newColour.get(id);
        if (into === undefined) continue;
        // follow the chain, in case the neighbour is itself being absorbed
        let target = into, guard = 0;
        while (newColour.has(target) && guard++ < 10) target = newColour.get(target);
        const colour = cellColourOf(cells, labels, target);
        if (colour && cells[i] !== colour) { cells[i] = colour; moved = true; }
      }
      if (!moved) return;
    }
  }

  function boxesOf(labels, count, cols, rows) {
    const boxes = [];
    for (let id = 0; id < count; id++) boxes.push({ x0: cols, y0: rows, x1: -1, y1: -1 });
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const id = labels[y * cols + x];
        if (id === NONE) continue;
        const box = boxes[id];
        if (x < box.x0) box.x0 = x;
        if (y < box.y0) box.y0 = y;
        if (x > box.x1) box.x1 = x;
        if (y > box.y1) box.y1 = y;
      }
    }
    return boxes;
  }

  const colourCache = new Map();
  function cellColourOf(cells, labels, id) {
    // the colour of any one square in that area is the colour of all of them
    if (colourCache.get(labels) === undefined) colourCache.set(labels, new Map());
    const seen = colourCache.get(labels);
    if (seen.has(id)) return seen.get(id);
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] === id) { seen.set(id, cells[i]); return cells[i]; }
    }
    seen.set(id, 0);
    return 0;
  }

  // ------------------------------------------------------------ outlines

  /* Walk the edge of an area and come back with closed loops of points.

     Every boundary square contributes the unit edges that face out of the
     area, wound so the inside is always on the same side. Those edges are
     then stitched end to end, which gives one loop for the outside and one
     more for each hole. */
  function trace(labels, cols, rows, id, cellsOf) {
    const edges = new Map();          // "x,y" of the start point -> [end point]
    const key = (x, y) => x + ',' + y;

    const add = (x0, y0, x1, y1) => {
      const k = key(x0, y0);
      const list = edges.get(k);
      if (list) list.push([x1, y1]);
      else edges.set(k, [[x1, y1]]);
    };

    const inside = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && labels[y * cols + x] === id;

    for (const i of cellsOf) {
      const x = i % cols, y = (i - (i % cols)) / cols;
      if (!inside(x, y - 1)) add(x, y, x + 1, y);              // top, left to right
      if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);      // right, down
      if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);      // bottom, back
      if (!inside(x - 1, y)) add(x, y + 1, x, y);              // left, up
    }

    const rings = [];
    while (edges.size) {
      const startKey = edges.keys().next().value;
      const [sx, sy] = startKey.split(',').map(Number);
      const ring = [[sx, sy]];
      let x = sx, y = sy;

      for (let guard = 0; guard < cols * rows * 4 + 16; guard++) {
        const list = edges.get(key(x, y));
        if (!list || !list.length) break;
        /* At a point where four squares meet, two edges leave the same
           corner. Taking the sharpest left turn keeps the walk on one loop
           instead of jumping across to the other. */
        let pick = 0;
        if (list.length > 1) {
          const from = ring.length > 1 ? ring[ring.length - 2] : [x - 1, y];
          const dx = x - from[0], dy = y - from[1];
          let bestTurn = -Infinity;
          list.forEach(([nx, ny], index) => {
            const ex = nx - x, ey = ny - y;
            const cross = dx * ey - dy * ex;
            const dot = dx * ex + dy * ey;
            const turn = cross !== 0 ? cross * 2 : (dot > 0 ? 1 : -3);
            if (turn > bestTurn) { bestTurn = turn; pick = index; }
          });
        }
        const [nx, ny] = list.splice(pick, 1)[0];
        if (!list.length) edges.delete(key(x, y));
        x = nx; y = ny;
        if (x === sx && y === sy) break;
        ring.push([x, y]);
      }

      if (ring.length >= 4) rings.push(ring);
    }

    return rings;
  }

  /* Where three or more areas meet, the outlines have to agree. Every
     boundary is therefore cut into arcs that run from one meeting point to
     the next, each arc belonging to exactly two areas, and each arc is
     tidied up once and shared. Simplifying an area's outline on its own
     would let two neighbours disagree about the line between them and open
     a white gap along it. */
  function junctions(labels, cols, rows) {
    const set = new Set();
    const at = (x, y) => (x < 0 || y < 0 || x >= cols || y >= rows) ? -2 : labels[y * cols + x];
    for (let y = 0; y <= rows; y++) {
      for (let x = 0; x <= cols; x++) {
        const around = new Set([at(x - 1, y - 1), at(x, y - 1), at(x - 1, y), at(x, y)]);
        if (around.size >= 3) set.add(x + ',' + y);
      }
    }
    // the four corners of the picture are meeting points too
    set.add('0,0');
    set.add(cols + ',0');
    set.add('0,' + rows);
    set.add(cols + ',' + rows);
    return set;
  }

  // Douglas–Peucker: throw away every point that the line would pass within
  // `tolerance` of anyway, which is what takes a staircase back to a slope.
  function simplify(points, tolerance) {
    if (points.length < 3) return points.slice();
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    const limit = tolerance * tolerance;

    while (stack.length) {
      const [from, to] = stack.pop();
      if (to <= from + 1) continue;
      const [ax, ay] = points[from], [bx, by] = points[to];
      const dx = bx - ax, dy = by - ay;
      const lengthSquared = dx * dx + dy * dy;
      let worst = -1, worstDistance = -1;
      for (let i = from + 1; i < to; i++) {
        const [px, py] = points[i];
        let distance;
        if (lengthSquared === 0) {
          distance = (px - ax) ** 2 + (py - ay) ** 2;
        } else {
          let t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          distance = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
        }
        if (distance > worstDistance) { worstDistance = distance; worst = i; }
      }
      if (worstDistance > limit) {
        keep[worst] = 1;
        stack.push([from, worst], [worst, to]);
      }
    }

    return points.filter((_, i) => keep[i]);
  }

  // Chaikin again, but along an arc rather than around a ring: the two ends
  // stay put so the arcs either side of a meeting point still meet.
  function smoothArc(points, passes) {
    let current = points;
    for (let pass = 0; pass < passes; pass++) {
      if (current.length < 3) break;
      const next = [current[0]];
      for (let i = 0; i < current.length - 1; i++) {
        const a = current[i], b = current[i + 1];
        next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
        next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      next.push(current[current.length - 1]);
      current = next;
    }
    return current;
  }

  /* Cut a traced ring at the meeting points it passes through, so the ring
     becomes a sequence of arcs. A ring with no meeting points on it at all —
     an island sitting inside one other area — is one closed arc, started at
     its lowest point so that both areas begin it in the same place. */
  function splitAtJunctions(ring, isJunction) {
    const marks = [];
    for (let i = 0; i < ring.length; i++) if (isJunction(ring[i])) marks.push(i);

    if (!marks.length) {
      let start = 0;
      for (let i = 1; i < ring.length; i++) {
        if (ring[i][1] < ring[start][1] || (ring[i][1] === ring[start][1] && ring[i][0] < ring[start][0])) start = i;
      }
      const rotated = ring.slice(start).concat(ring.slice(0, start));
      rotated.push(rotated[0]);
      return [rotated];
    }

    const arcs = [];
    for (let m = 0; m < marks.length; m++) {
      const from = marks[m], to = marks[(m + 1) % marks.length];
      const arc = [];
      for (let i = from; ; i = (i + 1) % ring.length) {
        arc.push(ring[i]);
        if (i === to) break;
      }
      if (arc.length > 1) arcs.push(arc);
    }
    return arcs;
  }

  // Both areas either side of an arc must end up with the same curve, so the
  // arc is keyed by its two ends and its middle, and worked out once.
  function arcKey(arc) {
    const first = arc[0], last = arc[arc.length - 1];
    const middle = arc[Math.floor(arc.length / 2)];
    const a = first[0] + ',' + first[1], b = last[0] + ',' + last[1];
    const m = middle[0] + ',' + middle[1];
    return (a <= b ? a + '|' + b : b + '|' + a) + '|' + m + '|' + arc.length;
  }

  // Drop the middle of a straight run: three points in a line only need two.
  function straighten(ring) {
    const out = [];
    for (let i = 0; i < ring.length; i++) {
      const previous = ring[(i - 1 + ring.length) % ring.length];
      const point = ring[i];
      const next = ring[(i + 1) % ring.length];
      const cross = (point[0] - previous[0]) * (next[1] - point[1]) - (point[1] - previous[1]) * (next[0] - point[0]);
      if (cross !== 0) out.push(point);
    }
    return out.length >= 3 ? out : ring;
  }

  /* Round the staircase off. Chaikin's corner cutting replaces each corner
     with the points a quarter and three quarters along its edges, twice.

     Two areas either side of the same edge cut it into exactly the same
     points, because a quarter of the way along an edge is the same place
     whichever end you start from — so their outlines stay together and no
     gap opens up between them. */
  function smooth(ring, passes, pinned) {
    let points = ring;
    for (let pass = 0; pass < passes; pass++) {
      const next = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        /* A point on the edge of the picture is left exactly where it is.
           Cutting those corners would round the picture itself off and leave
           a white crescent between the artwork and its own border. */
        if (pinned && pinned(a)) next.push(a);
        else next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
        if (pinned && pinned(b)) next.push(b);
        else next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      points = next.filter((point, i) => {
        const previous = next[(i - 1 + next.length) % next.length];
        return point[0] !== previous[0] || point[1] !== previous[1];
      });
    }
    return points;
  }

  // ------------------------------------------------------ where the number goes

  /* The centre of an area is no good for a number: the middle of a crescent
     is outside it. This finds the square furthest from any edge — the place
     with the most room around it — with a two-pass chamfer distance. */
  function labelPoint(labels, cols, rows, id, bbox) {
    const width = bbox.x1 - bbox.x0 + 1, height = bbox.y1 - bbox.y0 + 1;
    const distance = new Float32Array(width * height);
    const at = (x, y) => (y - bbox.y0) * width + (x - bbox.x0);
    const inside = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && labels[y * cols + x] === id;

    for (let y = bbox.y0; y <= bbox.y1; y++) {
      for (let x = bbox.x0; x <= bbox.x1; x++) distance[at(x, y)] = inside(x, y) ? Infinity : 0;
    }
    const near = (x, y) => (x < bbox.x0 || y < bbox.y0 || x > bbox.x1 || y > bbox.y1) ? 0 : distance[at(x, y)];

    for (let y = bbox.y0; y <= bbox.y1; y++) {
      for (let x = bbox.x0; x <= bbox.x1; x++) {
        if (!distance[at(x, y)]) continue;
        distance[at(x, y)] = Math.min(distance[at(x, y)],
          near(x - 1, y) + 1, near(x, y - 1) + 1,
          near(x - 1, y - 1) + 1.414, near(x + 1, y - 1) + 1.414);
      }
    }
    let best = null, bestDistance = -1;
    for (let y = bbox.y1; y >= bbox.y0; y--) {
      for (let x = bbox.x1; x >= bbox.x0; x--) {
        if (!distance[at(x, y)]) continue;
        distance[at(x, y)] = Math.min(distance[at(x, y)],
          near(x + 1, y) + 1, near(x, y + 1) + 1,
          near(x + 1, y + 1) + 1.414, near(x - 1, y + 1) + 1.414);
        if (distance[at(x, y)] > bestDistance) {
          bestDistance = distance[at(x, y)];
          best = [x + 0.5, y + 0.5];
        }
      }
    }

    return { x: best ? best[0] : bbox.x0 + 0.5, y: best ? best[1] : bbox.y0 + 0.5, room: bestDistance };
  }

  // -------------------------------------------------------------- the lot

  /* Take a puzzle's grid of colour numbers and hand back everything needed
     to draw it: the areas, their outlines, where each number sits, and a
     palette with any colour that no longer appears taken out. */
  function prepare(puzzle, options) {
    const settings = Object.assign({ minArea: 12, minRoom: 1.6, smoothing: 2, simplify: 0.9 }, options || {});
    const cols = puzzle.cols, rows = puzzle.rows;
    const cells = Uint8Array.from(puzzle.cells);

    colourCache.clear();
    if (settings.minArea > 1 || settings.minRoom > 0) {
      absorbSmall(cells, cols, rows, settings.minArea, settings.minRoom);
    }
    colourCache.clear();

    const { labels, areas, colours } = label(cells, cols, rows);

    // gather the squares of each area, and its bounding box
    const members = areas.map(() => []);
    const boxes = boxesOf(labels, areas.length, cols, rows);
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] !== NONE) members[labels[i]].push(i);
    }

    // a palette without the colours that merging did away with
    const used = new Set(colours);
    const remap = new Map();
    const palette = [];
    puzzle.palette.forEach((swatch, index) => {
      if (!used.has(index + 1)) return;
      palette.push(swatch);
      remap.set(index + 1, palette.length);
    });
    for (let i = 0; i < cells.length; i++) if (cells[i]) cells[i] = remap.get(cells[i]);

    const meeting = junctions(labels, cols, rows);
    const isJunction = ([x, y]) => meeting.has(x + ',' + y);
    const arcShapes = new Map();

    const shapeFor = (arc) => {
      const key = arcKey(arc);
      const known = arcShapes.get(key);
      const forward = arc[0][0] < arc[arc.length - 1][0] ||
        (arc[0][0] === arc[arc.length - 1][0] && arc[0][1] <= arc[arc.length - 1][1]);
      if (known) return forward ? known : known.slice().reverse();
      const canonical = forward ? arc : arc.slice().reverse();
      const shape = smoothArc(simplify(canonical, settings.simplify), settings.smoothing);
      arcShapes.set(key, shape);
      return forward ? shape : shape.slice().reverse();
    };

    const regions = areas.map((area, id) => {
      const rings = trace(labels, cols, rows, id, members[id]).map(ring => {
        const out = [];
        for (const arc of splitAtJunctions(ring, isJunction)) {
          const shape = shapeFor(arc);
          for (let i = 0; i < shape.length - 1; i++) out.push(shape[i]);
        }
        return out.length >= 3 ? out : ring;
      });
      return {
        id,
        colour: remap.get(colours[id]),
        area,
        rings,
        bbox: boxes[id],
        label: labelPoint(labels, cols, rows, id, boxes[id]),
      };
    });

    return { cols, rows, cells, labels, palette, regions };
  }

  // An outline as an SVG path, for saving the picture as line art.
  function ringsToPath(rings, decimals) {
    const round = (value) => Number(value.toFixed(decimals === undefined ? 2 : decimals));
    return rings.map(ring => 'M' + ring.map(([x, y]) => round(x) + ' ' + round(y)).join('L') + 'Z').join('');
  }

  const api = { prepare, label, trace, smooth, smoothArc, simplify, straighten, junctions, labelPoint, ringsToPath };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else self.PigmentRegions = api;
})();
