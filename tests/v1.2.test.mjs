import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs";
test("freeshot source flow",()=>{const s=fs.readFileSync("src/extractors/freeshot.ts","utf8");assert.match(s,/popcdn\.day\/player/);assert.match(s,/streamUrl/);assert.match(s,/planetary\.lovecdn\.ru/);});
test("vavoo resolver UA",()=>{const s=fs.readFileSync("src/extractors/vavoo.ts","utf8");assert.match(s,/okhttp\/4\.11\.0/);});
