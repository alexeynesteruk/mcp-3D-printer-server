import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const indexModulePath = path.join(repoRoot, "dist", "index.js");

async function importServer() {
  return await import(indexModulePath);
}

// Build a canned PrinterFilesResult with N synthetic entries
function makeFixture(count) {
  const files = [];
  for (let i = 0; i < count; i++) {
    files.push({
      name: `file_${i}.gcode`,
      path: `local/file_${i}.gcode`,
      size: 1000 + i,
      date: 1700000000 + i,
      type: "file",
      origin: "local",
    });
  }
  return { files, total: count, truncated: false, raw: { original: "payload" } };
}

// Helper to obtain a projector callable. If extracted to a pure function,
// prefer that; otherwise instantiate the class and use its method.
async function getProjector() {
  const mod = await importServer();
  if (typeof mod.projectFilesResult === "function") {
    return mod.projectFilesResult.bind(mod);
  }
  // Fallback: find the class by scanning exports
  for (const key of Object.keys(mod)) {
    const Cls = mod[key];
    if (typeof Cls === "function" && Cls.prototype && typeof Cls.prototype.projectFilesResult === "function") {
      const instance = new Cls();
      return instance.projectFilesResult.bind(instance);
    }
  }
  throw new Error("Could not locate projectFilesResult");
}

test("projectFilesResult: default args cap at 50 and project to name/size/date", async () => {
  const project = await getProjector();
  const input = makeFixture(100);
  const out = project(input, {});
  assert.equal(out.files.length, 50);
  assert.equal(out.total, 100);
  assert.equal(out.truncated, true);
  assert.equal(out.raw, undefined);
  // Default fields
  const keys = Object.keys(out.files[0]).sort();
  assert.deepEqual(keys, ["date", "name", "size"]);
});

test("projectFilesResult: limit of 5 trims and flags truncated", async () => {
  const project = await getProjector();
  const out = project(makeFixture(100), { limit: 5 });
  assert.equal(out.files.length, 5);
  assert.equal(out.total, 100);
  assert.equal(out.truncated, true);
});

test("projectFilesResult: limit of 0 means unlimited", async () => {
  const project = await getProjector();
  const out = project(makeFixture(100), { limit: 0 });
  assert.equal(out.files.length, 100);
  assert.equal(out.truncated, false);
});

test("projectFilesResult: limit clamped to 500 max", async () => {
  const project = await getProjector();
  const out = project(makeFixture(1000), { limit: 999 });
  // 999 should be clamped to 500
  assert.equal(out.files.length, 500);
  assert.equal(out.truncated, true);
});

test("projectFilesResult: custom fields subset", async () => {
  const project = await getProjector();
  const out = project(makeFixture(10), { fields: ["name", "path"] });
  assert.equal(out.files.length, 10);
  const keys = Object.keys(out.files[0]).sort();
  assert.deepEqual(keys, ["name", "path"]);
});

test("projectFilesResult: unknown fields are silently dropped", async () => {
  const project = await getProjector();
  const out = project(makeFixture(5), { fields: ["name", "bogus", "path"] });
  const keys = Object.keys(out.files[0]).sort();
  assert.deepEqual(keys, ["name", "path"]);
});

test("projectFilesResult: raw=true includes raw payload", async () => {
  const project = await getProjector();
  const out = project(makeFixture(10), { raw: true });
  assert.deepEqual(out.raw, { original: "payload" });
});

test("projectFilesResult: raw=false (default) omits raw payload", async () => {
  const project = await getProjector();
  const out = project(makeFixture(10), {});
  assert.equal(out.raw, undefined);
});

test("projectFilesResult: missing fields on entries are skipped, not serialized as undefined", async () => {
  const project = await getProjector();
  // Bambu-style fixture with no size or date
  const input = {
    files: [
      { name: "a.gcode", path: "cache/a.gcode", origin: "cache", type: "file" },
    ],
    total: 1,
    truncated: false,
  };
  const out = project(input, { fields: ["name", "size", "date"] });
  const keys = Object.keys(out.files[0]).sort();
  assert.deepEqual(keys, ["name"]);
});

test("projectFilesResult: empty input returns empty files, total 0, truncated false", async () => {
  const project = await getProjector();
  const out = project({ files: [], total: 0, truncated: false }, {});
  assert.equal(out.files.length, 0);
  assert.equal(out.total, 0);
  assert.equal(out.truncated, false);
});
