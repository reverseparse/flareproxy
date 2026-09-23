import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs";
test("freeshot uses current wideiptv player",()=>{const s=fs.readFileSync("src/extractors/freeshot.ts","utf8");assert.match(s,/wideiptv\.top\/player/);assert.match(s,/streamUrl/);});
test("hls proxy extracts before fetching specialized URL",()=>{const s=fs.readFileSync("src/router.ts","utf8");assert.match(s,/specialized/);assert.match(s,/extractVideo\(target\.toString/);});
test("vavoo resolver matches EasyProxy endpoint",()=>{const s=fs.readFileSync("src/extractors/vavoo.ts","utf8");assert.match(s,/vavoo\.to\/mediahubmx-resolve\.json/);assert.match(s,/vavoo-iptv\/play/);});
