import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function distPath(adapter) {
  return path.join(repoRoot, "dist", "printers", `${adapter}.js`);
}

// ---------------------------------------------------------------------------
// OctoPrint
// ---------------------------------------------------------------------------

const octoFixture = {
  files: [
    { name: "a.gcode", path: "a.gcode", type: "machinecode", size: 1234, date: 1700000000 },
    {
      name: "sub",
      path: "sub",
      type: "folder",
      children: [
        { name: "b.gcode", path: "sub/b.gcode", type: "machinecode", size: 5, date: 1700000050 },
      ],
    },
  ],
};

test("OctoPrint normalizeFiles: flattens nested files and folders", async () => {
  const { normalizeFiles } = await import(distPath("octoprint"));

  const entries = normalizeFiles(octoFixture);
  assert.equal(entries.length, 3, "should have 3 entries (a.gcode, sub folder, sub/b.gcode)");

  const aEntry = entries.find((e) => e.name === "a.gcode");
  assert.ok(aEntry, "a.gcode entry must exist");
  assert.equal(aEntry.type, "file");
  assert.equal(aEntry.path, "a.gcode");
  assert.equal(aEntry.size, 1234);
  assert.equal(aEntry.date, 1700000000);
  assert.equal(aEntry.origin, "local");

  const subEntry = entries.find((e) => e.name === "sub");
  assert.ok(subEntry, "sub folder entry must exist");
  assert.equal(subEntry.type, "folder");
  assert.equal(subEntry.origin, "local");

  const bEntry = entries.find((e) => e.name === "b.gcode");
  assert.ok(bEntry, "sub/b.gcode entry must exist");
  assert.equal(bEntry.type, "file");
  assert.equal(bEntry.path, "sub/b.gcode");
  assert.equal(bEntry.size, 5);
  assert.equal(bEntry.date, 1700000050);
  assert.equal(bEntry.origin, "local");
});

test("OctoPrint normalizeFiles: defensive parse (null/undefined/string/[])", async () => {
  const { normalizeFiles } = await import(distPath("octoprint"));

  assert.deepEqual(normalizeFiles(null), []);
  assert.deepEqual(normalizeFiles(undefined), []);
  assert.deepEqual(normalizeFiles("string"), []);
  assert.deepEqual(normalizeFiles([]), []);
});

// ---------------------------------------------------------------------------
// Klipper
// ---------------------------------------------------------------------------

const klipperFixture = {
  result: [
    { path: "gcodes/benchy.gcode", modified: 1700000000.5, size: 42, permissions: "rw" },
  ],
};

test("Klipper normalizeFiles: maps Moonraker file list", async () => {
  const { normalizeFiles } = await import(distPath("klipper"));

  const entries = normalizeFiles(klipperFixture);
  assert.equal(entries.length, 1);

  const entry = entries[0];
  assert.equal(entry.name, "benchy.gcode");
  assert.equal(entry.path, "gcodes/benchy.gcode");
  assert.equal(entry.size, 42);
  assert.equal(entry.date, 1700000000, "date must be floored integer epoch");
  assert.equal(entry.origin, "gcodes");
  assert.equal(entry.type, "file");
});

test("Klipper normalizeFiles: defensive parse (null/undefined/string/[])", async () => {
  const { normalizeFiles } = await import(distPath("klipper"));

  assert.deepEqual(normalizeFiles(null), []);
  assert.deepEqual(normalizeFiles(undefined), []);
  assert.deepEqual(normalizeFiles("string"), []);
  assert.deepEqual(normalizeFiles([]), []);
});

// ---------------------------------------------------------------------------
// Duet
// ---------------------------------------------------------------------------

const duetFixtureV3 = {
  dir: "/gcodes",
  files: [
    { type: "f", name: "x.g", size: 10, date: "2024-01-02T03:04:05" },
    { type: "d", name: "sub", size: 0, date: "2024-01-02T03:04:05" },
  ],
};

test("Duet normalizeFiles: maps RRF v3 file list with ISO dates", async () => {
  const { normalizeFiles } = await import(distPath("duet"));

  const entries = normalizeFiles(duetFixtureV3);
  assert.equal(entries.length, 2);

  const fileEntry = entries.find((e) => e.name === "x.g");
  assert.ok(fileEntry, "x.g entry must exist");
  assert.equal(fileEntry.type, "file");
  assert.equal(fileEntry.path, "/gcodes/x.g");
  assert.equal(fileEntry.size, 10);
  // ISO "2024-01-02T03:04:05" -> epoch seconds (integer)
  assert.equal(typeof fileEntry.date, "number");
  assert.ok(Number.isInteger(fileEntry.date), "date must be integer epoch");

  const folderEntry = entries.find((e) => e.name === "sub");
  assert.ok(folderEntry, "sub folder entry must exist");
  assert.equal(folderEntry.type, "folder");
});

test("Duet normalizeFiles: defensive parse (null/undefined/string/[])", async () => {
  const { normalizeFiles } = await import(distPath("duet"));

  assert.deepEqual(normalizeFiles(null), []);
  assert.deepEqual(normalizeFiles(undefined), []);
  assert.deepEqual(normalizeFiles("string"), []);
  assert.deepEqual(normalizeFiles([]), []);
});

// ---------------------------------------------------------------------------
// Prusa
// ---------------------------------------------------------------------------

const prusaV1Fixture = {
  children: [
    { name: "x.bgcode", type: "FILE", size: 10, m_timestamp: 1700000000 },
    { name: "fold", type: "FOLDER", size: 0, m_timestamp: 1700000000 },
  ],
};

const prusaLegacyFixture = {
  files: [{ name: "a.gcode", path: "a.gcode", type: "machinecode", size: 1, date: 1700000000 }],
};

test("Prusa normalizeFiles: maps v1 children shape", async () => {
  const { normalizeFiles } = await import(distPath("prusa"));

  const entries = normalizeFiles(prusaV1Fixture);
  assert.equal(entries.length, 2);

  const fileEntry = entries.find((e) => e.name === "x.bgcode");
  assert.ok(fileEntry);
  assert.equal(fileEntry.type, "file", "type must be lowercased");
  assert.equal(fileEntry.size, 10);
  assert.equal(fileEntry.date, 1700000000);

  const folderEntry = entries.find((e) => e.name === "fold");
  assert.ok(folderEntry);
  assert.equal(folderEntry.type, "folder", "FOLDER must map to folder");
});

test("Prusa normalizeFiles: maps legacy OctoPrint-shaped response", async () => {
  const { normalizeFiles } = await import(distPath("prusa"));

  const entries = normalizeFiles(prusaLegacyFixture);
  assert.equal(entries.length, 1);

  const entry = entries[0];
  assert.equal(entry.name, "a.gcode");
  assert.equal(entry.path, "a.gcode");
  assert.equal(entry.size, 1);
  assert.equal(entry.date, 1700000000);
  assert.equal(entry.type, "file");
});

test("Prusa normalizeFiles: defensive parse (null/undefined/string/[])", async () => {
  const { normalizeFiles } = await import(distPath("prusa"));

  assert.deepEqual(normalizeFiles(null), []);
  assert.deepEqual(normalizeFiles(undefined), []);
  assert.deepEqual(normalizeFiles("string"), []);
  assert.deepEqual(normalizeFiles([]), []);
});

// ---------------------------------------------------------------------------
// Creality
// ---------------------------------------------------------------------------

const cr1 = { files: ["a.gcode", "b.gcode"] };
const cr2 = { files: [{ name: "a.gcode", size: 5 }] };
const cr3 = "hello";

test("Creality normalizeFiles: string array maps to name-only entries", async () => {
  const { normalizeFiles } = await import(distPath("creality"));

  const entries = normalizeFiles(cr1);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, "a.gcode");
  assert.equal(entries[1].name, "b.gcode");
});

test("Creality normalizeFiles: object array projects name and size", async () => {
  const { normalizeFiles } = await import(distPath("creality"));

  const entries = normalizeFiles(cr2);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, "a.gcode");
  assert.equal(entries[0].size, 5);
});

test("Creality normalizeFiles: garbage input returns []", async () => {
  const { normalizeFiles } = await import(distPath("creality"));

  assert.deepEqual(normalizeFiles(cr3), []);
});

test("Creality normalizeFiles: defensive parse (null/undefined/string/[])", async () => {
  const { normalizeFiles } = await import(distPath("creality"));

  assert.deepEqual(normalizeFiles(null), []);
  assert.deepEqual(normalizeFiles(undefined), []);
  assert.deepEqual(normalizeFiles("string"), []);
  assert.deepEqual(normalizeFiles([]), []);
});

// ---------------------------------------------------------------------------
// Repetier
// ---------------------------------------------------------------------------

const repetierFixture = {
  dir: "/sd",
  files: [
    { name: "a.g", type: 0, size: 5, date: 1700000000 },
    "b.g",
  ],
};

test("Repetier normalizeFiles: maps mixed files array", async () => {
  const { normalizeFiles } = await import(distPath("repetier"));

  const entries = normalizeFiles(repetierFixture);
  assert.equal(entries.length, 2);

  const aEntry = entries.find((e) => e.name === "a.g");
  assert.ok(aEntry, "a.g object entry must exist");
  assert.equal(aEntry.size, 5);
  assert.equal(aEntry.date, 1700000000);
  assert.equal(aEntry.type, "file");
  assert.equal(aEntry.origin, "sd", "origin should be dir stripped of leading slash");

  const bEntry = entries.find((e) => e.name === "b.g");
  assert.ok(bEntry, "b.g string entry must exist");
  assert.equal(bEntry.origin, "sd");
});

test("Repetier normalizeFiles: defensive parse (null/undefined/string/[])", async () => {
  const { normalizeFiles } = await import(distPath("repetier"));

  assert.deepEqual(normalizeFiles(null), []);
  assert.deepEqual(normalizeFiles(undefined), []);
  assert.deepEqual(normalizeFiles("string"), []);
  assert.deepEqual(normalizeFiles([]), []);
});

// ---------------------------------------------------------------------------
// Bambu
// ---------------------------------------------------------------------------

const bambuFixture = {
  files: ["cache/x.gcode", "cache/y.gcode", "timelapse/v.mp4"],
  directories: { cache: ["x.gcode", "y.gcode"], timelapse: ["v.mp4"], logs: [] },
};

test("Bambu normalizeFiles: flattens directories into entries", async () => {
  const { normalizeFiles } = await import(distPath("bambu"));

  const entries = normalizeFiles(bambuFixture);
  // directories: cache has 2, timelapse has 1, logs has 0 = 3 total
  assert.equal(entries.length, 3);

  const xEntry = entries.find((e) => e.name === "x.gcode");
  assert.ok(xEntry, "x.gcode must exist");
  assert.equal(xEntry.path, "cache/x.gcode");
  assert.equal(xEntry.origin, "cache");
  assert.equal(xEntry.type, "file");

  const vEntry = entries.find((e) => e.name === "v.mp4");
  assert.ok(vEntry, "v.mp4 must exist");
  assert.equal(vEntry.path, "timelapse/v.mp4");
  assert.equal(vEntry.origin, "timelapse");
  assert.equal(vEntry.type, "file");
});

test("Bambu normalizeFiles: falls back to flat files array when directories absent", async () => {
  const { normalizeFiles } = await import(distPath("bambu"));

  const flatFixture = { files: ["cache/x.gcode", "timelapse/v.mp4"] };
  const entries = normalizeFiles(flatFixture);
  assert.equal(entries.length, 2);

  const xEntry = entries.find((e) => e.name === "x.gcode");
  assert.ok(xEntry);
  assert.equal(xEntry.path, "cache/x.gcode");
  assert.equal(xEntry.origin, "cache");
});

test("Bambu normalizeFiles: defensive parse (null/undefined/string/[])", async () => {
  const { normalizeFiles } = await import(distPath("bambu"));

  assert.deepEqual(normalizeFiles(null), []);
  assert.deepEqual(normalizeFiles(undefined), []);
  assert.deepEqual(normalizeFiles("string"), []);
  assert.deepEqual(normalizeFiles([]), []);
});
