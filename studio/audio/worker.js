/* The room next door: the engine, running where it can't hold up the page. */

import { createEngine } from './engine.js';

const engine = createEngine((msg, transfer) => self.postMessage(msg, transfer || []));
self.onmessage = e => engine(e.data);
