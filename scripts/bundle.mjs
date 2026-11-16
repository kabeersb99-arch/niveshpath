// Rebuild www/data/bundle.js from facts.json and live.json (run after editing either by hand).
import { writeBundle } from './lib.mjs';
await writeBundle();
console.log('www/data/bundle.js written');
