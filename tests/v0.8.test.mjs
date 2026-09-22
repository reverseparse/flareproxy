import test from "node:test";
import assert from "node:assert/strict";

test("v0.8 package version", async () => {
  const pkg = await import("../package.json", { with: { type: "json" } });
  assert.equal(pkg.default.version, "0.8.0");
});

test("generic extractor source contains no HTML-to-URL fallback", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../src/extractors/generic.ts", import.meta.url), "utf8");
  assert.match(source, /Deliberately require a media extension/);
  assert.doesNotMatch(source, /candidateUrls/);
});

test("dedicated extractors are registered", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../src/extractors/registry.ts", import.meta.url), "utf8");
  assert.match(source, /vavooExtractor/);
  assert.match(source, /dlhdExtractor/);
  assert.match(source, /vixsrcExtractor/);
});
