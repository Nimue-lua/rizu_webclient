import assert from "node:assert/strict";
import test from "node:test";
import { NoteSkinCatalog } from "../src/noteskin/NoteSkinCatalog";

test("starts with built-in skins that cannot be deleted", async () => {
  const catalog = new NoteSkinCatalog();
  assert.ok(catalog.getOptions().every((option) => option.builtIn));
  await assert.rejects(catalog.delete("osu-default"), /Only imported skins/);
});
