import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("V1.1 contains EasyProxy-aligned Vavoo resolver endpoint", () => {
  const source = fs.readFileSync("src/extractors/vavoo.ts", "utf8");
  assert.match(source, /vavoo\.to\/mediahubmx-resolve\.json/);
  assert.match(source, /vavoo-iptv\/play/);
});

test("V1.1 rejects non-manifest upstream bodies", () => {
  const source = fs.readFileSync("src/router.ts", "utf8");
  assert.match(source, /UPSTREAM_NOT_MANIFEST/);
  assert.match(source, /UPSTREAM_NOT_MEDIA/);
});
