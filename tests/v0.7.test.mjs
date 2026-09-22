import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("V0.7 exposes EasyProxy extractor aliases", () => {
  const router = fs.readFileSync(new URL("../src/router.ts", import.meta.url), "utf8");
  for (const route of [
    "/extractor/video",
    "/extractor/video.m3u8",
    "/extractor/video.mp4",
    "/extractor/video.ts",
    "/extractor/video.mkv",
    "/extractor/video.webm"
  ]) assert.match(router, new RegExp(route.replaceAll(".", "\\.")));
});

test("generic extractor never uses the complete HTML document as destination URL", () => {
  const generic = fs.readFileSync(new URL("../src/extractors/generic.ts", import.meta.url), "utf8");
  assert.match(generic, /Never use the whole HTML document as a URL/);
  assert.doesNotMatch(generic, /out\.add\(new URL\(text\.trim\(\), base\)/);
});

test("VixSrc is specialized and generic is fallback", () => {
  const registry = fs.readFileSync(new URL("../src/extractors/registry.ts", import.meta.url), "utf8");
  assert.match(registry, /vixsrcExtractor/);
  assert.match(registry, /vixsrcExtractor,\s*genericExtractor/);
});
