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

/**
 * Install a fake BambuClientStore that returns a stub printer whose
 * executeCommand is a no-op and whose `data` is the canned payload.
 */
function installFakeStore(impl, data) {
  impl.printerStore = {
    async getPrinter() {
      return {
        data,
        async executeCommand() {},
        async publish() {},
      };
    },
    async disconnectAll() {},
  };
}

test("getStatus returns null ams_2_pro and ai_detection for bare P1S-shape payload", async () => {
  const { BambuImplementation } = await importBambu();
  const impl = new BambuImplementation(null);

  installFakeStore(impl, {
    gcode_state: "IDLE",
    nozzle_temper: 30, nozzle_target_temper: 0,
    bed_temper: 25,   bed_target_temper: 0,
    chamber_temper: 24,
    subtask_name: null,
    mc_percent: 0, mc_remaining_time: 0,
    layer_num: 0, total_layer_num: 0,
    ams: null,
  });

  const result = await impl.getStatus("host", "990", "SERIAL:TOKEN");
  assert.equal(result.connected, true);
  assert.equal(result.status, "IDLE");
  assert.equal(result.temperatures.chamber, 24);
  assert.equal(result.ams_2_pro, null);
  assert.equal(result.ai_detection, null);
});

test("getStatus surfaces ams_2_pro drying state from P2S-shape payload", async () => {
  const { BambuImplementation } = await importBambu();
  const impl = new BambuImplementation(null);

  installFakeStore(impl, {
    gcode_state: "RUNNING",
    nozzle_temper: 215, nozzle_target_temper: 215,
    bed_temper: 60,    bed_target_temper: 60,
    chamber_temper: 32,
    mc_percent: 42, mc_remaining_time: 55,
    layer_num: 88, total_layer_num: 212,
    ams: {
      ams: [
        {
          id: 0,
          humidity_pct: 22,
          tray: [
            { id: "0", drying: true, dry_temp: 55, dry_time: 90, target_humidity: 15 },
            { id: "1" },
            { id: "2" },
            { id: "3" },
          ],
        },
      ],
    },
  });

  const result = await impl.getStatus("host", "990", "SERIAL:TOKEN");
  assert.ok(result.ams_2_pro);
  assert.equal(result.ams_2_pro.units.length, 1);
  const slot0 = result.ams_2_pro.units[0].slots[0];
  assert.equal(slot0.drying_active, true);
  assert.equal(slot0.drying_temp_c, 55);
  assert.equal(slot0.dry_time_remaining_min, 90);
  assert.equal(slot0.target_humidity_pct, 15);
});

test("getStatus surfaces ai_detection triggered state", async () => {
  const { BambuImplementation } = await importBambu();
  const impl = new BambuImplementation(null);

  installFakeStore(impl, {
    gcode_state: "RUNNING",
    nozzle_temper: 0, nozzle_target_temper: 0,
    bed_temper: 0,    bed_target_temper: 0,
    chamber_temper: 0,
    mc_percent: 0, mc_remaining_time: 0,
    layer_num: 0, total_layer_num: 0,
    ams: null,
    xcam: {
      spaghetti_detector: true,
      first_layer_inspector: true,
    },
    xcam_status: {
      spaghetti_triggered: true,
      spaghetti_triggered_at: "2026-05-08T12:00:00Z",
    },
  });

  const result = await impl.getStatus("host", "990", "SERIAL:TOKEN");
  assert.ok(result.ai_detection);
  assert.equal(result.ai_detection.spaghetti.enabled, true);
  assert.equal(result.ai_detection.spaghetti.triggered, true);
  assert.equal(result.ai_detection.spaghetti.last_triggered_at, "2026-05-08T12:00:00Z");
  assert.equal(result.ai_detection.start_check.enabled, true);
  assert.equal(result.ai_detection.start_check.triggered, false);
});
