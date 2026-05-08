import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const bambuModulePath = path.join(repoRoot, "dist", "printers", "bambu.js");

async function importBambu() {
  return await import(bambuModulePath);
}

test("parseAms2Pro returns null on empty data", async () => {
  const { BambuImplementation } = await importBambu();
  const impl = new BambuImplementation(null);
  assert.equal(impl.parseAms2ProForTests({}), null);
  assert.equal(impl.parseAms2ProForTests({ ams: null }), null);
  assert.equal(impl.parseAms2ProForTests({ ams: { ams: [] } }), null);
});

test("parseAms2Pro maps legacy humidity scale (0-5) into humidity_pct", async () => {
  const { BambuImplementation } = await importBambu();
  const impl = new BambuImplementation(null);

  const data = {
    ams: {
      ams: [
        {
          id: 0,
          humidity: 2,
          tray: [
            { id: "0" },
            { id: "1" },
            { id: "2" },
            { id: "3" },
          ],
        },
      ],
    },
  };

  const result = impl.parseAms2ProForTests(data);
  assert.ok(result);
  assert.equal(result.units.length, 1);
  assert.equal(result.units[0].id, 0);
  assert.equal(result.units[0].slots.length, 4);
  // legacy humidity 2 on the 0-5 scale -> ~60% (linear map: 0 -> 100%, 5 -> 0%)
  for (const slot of result.units[0].slots) {
    assert.equal(slot.humidity_pct, 60);
  }
});

test("parseAms2Pro prefers humidity_pct when present", async () => {
  const { BambuImplementation } = await importBambu();
  const impl = new BambuImplementation(null);

  const data = {
    ams: {
      ams: [
        {
          id: 0,
          humidity: 2,
          humidity_pct: 38,
          tray: [{ id: "0" }],
        },
      ],
    },
  };

  const result = impl.parseAms2ProForTests(data);
  assert.equal(result.units[0].slots[0].humidity_pct, 38);
});

test("parseAms2Pro surfaces drying state per slot when present", async () => {
  const { BambuImplementation } = await importBambu();
  const impl = new BambuImplementation(null);

  const data = {
    ams: {
      ams: [
        {
          id: 0,
          humidity_pct: 40,
          tray: [
            {
              id: "0",
              drying: true,
              dry_temp: 55,
              dry_time: 120,
              target_humidity: 15,
            },
            { id: "1" },
          ],
        },
      ],
    },
  };

  const result = impl.parseAms2ProForTests(data);
  const slot0 = result.units[0].slots[0];
  assert.equal(slot0.drying_active, true);
  assert.equal(slot0.drying_temp_c, 55);
  assert.equal(slot0.dry_time_remaining_min, 120);
  assert.equal(slot0.target_humidity_pct, 15);

  const slot1 = result.units[0].slots[1];
  assert.equal(slot1.drying_active, undefined);
  assert.equal(slot1.drying_temp_c, undefined);
});
