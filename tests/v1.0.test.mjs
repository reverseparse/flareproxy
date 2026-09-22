import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("DLHD resolver supports direct stream iframe convention", async () => {
  const source = await fs.readFile(new URL("../src/extractors/dlhd.ts", import.meta.url), "utf8");
  assert.match(source, /stream-\\\\d+\\\\.php/);
  assert.match(source, /\/stream\/stream-\$\{channelId\}\.php/);
});
