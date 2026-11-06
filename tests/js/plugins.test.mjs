import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "plugins");

// Repo'daki her plugin kaynağı derlenebilir olmalı (bozuk syntax install'da patlamamalı)
for (const id of readdirSync(root)) {
  const mf = join(root, id, "manifest.json");
  if (!existsSync(mf)) continue;
  const manifest = JSON.parse(readFileSync(mf, "utf8"));
  test(`plugin ${id}: kaynak sozdizimi gecerli`, () => {
    const src = readFileSync(join(root, id, manifest.entry), "utf8");
    assert.doesNotThrow(() => new Function(src), `${id} sozdizimi hatali`);
    assert.equal(manifest.id, id);
  });
}
