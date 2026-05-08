# Bambu P2S Support + AMS 2 Pro / AI Detection Telemetry - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `BAMBU_MODEL=p2s` end-to-end support and enrich `getStatus` with `ams_2_pro` (humidity/drying) and `ai_detection` (spaghetti/nozzle-clumping/purge-chute-jam/start-check) blocks, without breaking any existing Bambu consumer.

**Architecture:** Additive-only changes on the existing `bambu-node` stack. Two surface touches: `src/index.ts` (validation list, preset map, elicitation schema) and `src/printers/bambu.ts` (defensive parsers + extended `getStatus` payload). New isolated test file against compiled `dist/`. No new MCP tools, no new env vars, no new dependencies.

**Tech Stack:** TypeScript (Node 18+, ESM), `bambu-node` (MQTT), `basic-ftp`, `@modelcontextprotocol/sdk`, `node --test` (no vitest/jest).

**Spec:** `docs/superpowers/specs/2026-05-08-bambu-p2s-support-design.md`

---

## File Structure

Files created or modified in this plan:

- `src/index.ts` (modify)
  - `VALID_BAMBU_MODELS` tuple: add `"p2s"`.
  - `BAMBU_MODEL_PRESETS`: add P2S entry.
  - `resolveBambuModel` elicitation `oneOf`: add P2S option.
- `src/printers/bambu.ts` (modify)
  - Add `Ams2ProSlotStatus`, `Ams2ProStatus`, `AiDetectionCategory`, `AiDetectionStatus` interfaces.
  - Add private `parseAms2Pro(data)` and `parseAiDetection(data)` helpers.
  - Extend `getStatus` return object with `ams_2_pro` and `ai_detection`.
- `tests/bambu-status.test.mjs` (create)
  - Standalone unit test of the parsers + `getStatus` shape via a mocked `BambuClient`.
- `README.md` (modify)
  - Update the two spots listing supported Bambu models.
  - Add a short section describing the new `ams_2_pro` and `ai_detection` status fields.
- `package.json` (modify, last step)
  - `npm version patch` to 1.2.4.

Keep files focused: all parsing logic stays inside `src/printers/bambu.ts` as private methods so tests touch one module and the public `getStatus` contract remains the integration point.

---

## Task 1: Add P2S to the static validation list

**Files:**
- Modify: `src/index.ts:50`

- [ ] **Step 1: Edit the VALID_BAMBU_MODELS tuple**

Open `src/index.ts`. Find line 50:

```ts
const VALID_BAMBU_MODELS = ["p1s", "p1p", "x1c", "x1e", "a1", "a1mini", "h2d"] as const;
```

Replace with (P2S inserted after P1P so the P-series stays grouped):

```ts
const VALID_BAMBU_MODELS = ["p1s", "p1p", "p2s", "x1c", "x1e", "a1", "a1mini", "h2d"] as const;
```

- [ ] **Step 2: Add the P2S preset**

Find the `BAMBU_MODEL_PRESETS` map starting at line 56. Replace:

```ts
const BAMBU_MODEL_PRESETS: Record<string, (nozzle: string) => string> = {
  p1s: (n) => `Bambu Lab P1S ${n} nozzle`,
  p1p: (n) => `Bambu Lab P1P ${n} nozzle`,
  x1c: (n) => `Bambu Lab X1 Carbon ${n} nozzle`,
  x1e: (n) => `Bambu Lab X1E ${n} nozzle`,
  a1: (n) => `Bambu Lab A1 ${n} nozzle`,
  a1mini: (n) => `Bambu Lab A1 mini ${n} nozzle`,
  h2d: (n) => `Bambu Lab H2D ${n} nozzle`,
};
```

with:

```ts
const BAMBU_MODEL_PRESETS: Record<string, (nozzle: string) => string> = {
  p1s: (n) => `Bambu Lab P1S ${n} nozzle`,
  p1p: (n) => `Bambu Lab P1P ${n} nozzle`,
  p2s: (n) => `Bambu Lab P2S ${n} nozzle`,
  x1c: (n) => `Bambu Lab X1 Carbon ${n} nozzle`,
  x1e: (n) => `Bambu Lab X1E ${n} nozzle`,
  a1: (n) => `Bambu Lab A1 ${n} nozzle`,
  a1mini: (n) => `Bambu Lab A1 mini ${n} nozzle`,
  h2d: (n) => `Bambu Lab H2D ${n} nozzle`,
};
```

- [ ] **Step 3: Add P2S to the elicitation schema**

Find the `resolveBambuModel` method around line 204-245. Inside the `oneOf` array, add P2S between P1P and X1 Carbon:

```ts
oneOf: [
  { const: "p1s", title: "P1S" },
  { const: "p1p", title: "P1P" },
  { const: "p2s", title: "P2S" },
  { const: "x1c", title: "X1 Carbon" },
  { const: "x1e", title: "X1E" },
  { const: "a1", title: "A1" },
  { const: "a1mini", title: "A1 Mini" },
  { const: "h2d", title: "H2D" },
],
```

- [ ] **Step 4: Build to confirm no TypeScript regressions**

Run: `npm run build`

Expected: exit code 0, no output except tsc running.

- [ ] **Step 5: Quick runtime sanity check**

Run (single line):

```bash
BAMBU_MODEL=p2s node -e "import('./dist/index.js').catch(e => { console.error('FAIL', e.message); process.exit(1) }); setTimeout(() => process.exit(0), 300)"
```

Expected: exits 0 with no stderr about invalid model. (The server will try to connect and fail because no serial/token/host is set - that is fine, we only care that model validation did not reject `p2s`.)

- [ ] **Step 6: Commit**

```bash
git add src/index.ts
git commit -m "feat(bambu): register P2S model (validation, preset, elicitation)"
```

---

## Task 2: Define AMS 2 Pro status types

**Files:**
- Modify: `src/printers/bambu.ts` (top of file, after existing `ProjectFileMetadata` interface near line 35)

- [ ] **Step 1: Add the AMS 2 Pro types**

Open `src/printers/bambu.ts`. Immediately after the `ProjectFileMetadata` interface (around line 35), add:

```ts
interface Ams2ProSlotStatus {
  slot: number;
  humidity_pct?: number;
  target_humidity_pct?: number;
  drying_active?: boolean;
  dry_time_remaining_min?: number;
  drying_temp_c?: number;
}

interface Ams2ProUnit {
  id: number;
  slots: Ams2ProSlotStatus[];
}

interface Ams2ProStatus {
  units: Ams2ProUnit[];
}
```

- [ ] **Step 2: Build to confirm the types compile**

Run: `npm run build`

Expected: exit code 0. If tsc complains about unused types, ignore for now - Task 3 will reference them.

- [ ] **Step 3: Commit**

```bash
git add src/printers/bambu.ts
git commit -m "feat(bambu): add AMS 2 Pro status types"
```

---

## Task 3: Implement parseAms2Pro

**Files:**
- Modify: `src/printers/bambu.ts`
- Test: `tests/bambu-parsers.test.mjs` (create in Task 5; written first here)

- [ ] **Step 1: Write the failing test file**

Create `tests/bambu-parsers.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm run build && node --test tests/bambu-parsers.test.mjs`

Expected: all four tests fail with something like
`TypeError: impl.parseAms2ProForTests is not a function`.

- [ ] **Step 3: Implement parseAms2Pro**

In `src/printers/bambu.ts`, inside the `BambuImplementation` class, add this method immediately after `resolveProjectFileMetadata` (around line 165). Code in full:

```ts
private parseAms2Pro(data: any): Ams2ProStatus | null {
  const amsRoot = data?.ams;
  const units = amsRoot?.ams;
  if (!Array.isArray(units) || units.length === 0) {
    return null;
  }

  const parsedUnits: Ams2ProUnit[] = [];

  for (const unit of units) {
    if (!unit || typeof unit !== "object") continue;
    const unitId = typeof unit.id === "number" ? unit.id : parseInt(String(unit.id ?? 0), 10) || 0;

    const unitHumidityPct = this.resolveHumidityPct(unit);
    const trays = Array.isArray(unit.tray) ? unit.tray : [];

    const slots: Ams2ProSlotStatus[] = trays.map((tray: any, index: number) => {
      const slotIndex = typeof tray?.id === "number" ? tray.id : parseInt(String(tray?.id ?? index), 10);
      const slot: Ams2ProSlotStatus = {
        slot: Number.isFinite(slotIndex) ? slotIndex : index,
      };

      const slotHumidity = this.resolveHumidityPct(tray);
      if (slotHumidity !== undefined) {
        slot.humidity_pct = slotHumidity;
      } else if (unitHumidityPct !== undefined) {
        slot.humidity_pct = unitHumidityPct;
      }

      if (typeof tray?.target_humidity === "number") {
        slot.target_humidity_pct = tray.target_humidity;
      }
      if (typeof tray?.drying === "boolean") {
        slot.drying_active = tray.drying;
      } else if (typeof tray?.dry_state === "string") {
        slot.drying_active = tray.dry_state.toLowerCase() === "drying";
      }
      if (typeof tray?.dry_temp === "number") {
        slot.drying_temp_c = tray.dry_temp;
      }
      if (typeof tray?.dry_time === "number") {
        slot.dry_time_remaining_min = tray.dry_time;
      }

      return slot;
    });

    if (slots.length === 0) continue;
    parsedUnits.push({ id: unitId, slots });
  }

  return parsedUnits.length > 0 ? { units: parsedUnits } : null;
}

/**
 * Bambu firmware uses two encodings for humidity:
 *   - legacy `humidity`: integer 0-5 (0 = bone dry, 5 = wet). Approximate to %.
 *   - newer `humidity_pct` / `humidity_raw`: already percent (0-100).
 * Prefer the percent form when present.
 */
private resolveHumidityPct(source: any): number | undefined {
  if (!source || typeof source !== "object") return undefined;
  if (typeof source.humidity_pct === "number") return source.humidity_pct;
  if (typeof source.humidity_raw === "number") return source.humidity_raw;
  if (typeof source.humidity === "number") {
    // 0..5 scale -> 0..100% approx
    const clamped = Math.max(0, Math.min(5, source.humidity));
    return Math.round((1 - clamped / 5) * 100);
  }
  return undefined;
}

// Test hook. Keeps the parser accessible from Node --test without exporting
// the whole private surface. Safe no-op for production callers.
parseAms2ProForTests(data: any): Ams2ProStatus | null {
  return this.parseAms2Pro(data);
}
```

- [ ] **Step 4: Build and re-run the tests**

Run: `npm run build && node --test tests/bambu-parsers.test.mjs`

Expected: all four `parseAms2Pro*` tests pass. No other tests run from this file yet.

- [ ] **Step 5: Commit**

```bash
git add src/printers/bambu.ts tests/bambu-parsers.test.mjs
git commit -m "feat(bambu): parseAms2Pro with defensive humidity + drying parsing"
```

---

## Task 4: Define and implement parseAiDetection

**Files:**
- Modify: `src/printers/bambu.ts`
- Test: `tests/bambu-parsers.test.mjs`

- [ ] **Step 1: Add AI detection types**

In `src/printers/bambu.ts`, just below the `Ams2ProStatus` interface, add:

```ts
interface AiDetectionCategory {
  enabled: boolean;
  triggered: boolean;
  last_triggered_at?: string;
}

interface AiDetectionStatus {
  spaghetti?: AiDetectionCategory;
  nozzle_clumping?: AiDetectionCategory;
  purge_chute_jam?: AiDetectionCategory;
  start_check?: AiDetectionCategory;
}
```

- [ ] **Step 2: Append failing tests for parseAiDetection**

Append to `tests/bambu-parsers.test.mjs`:

```js
test("parseAiDetection returns null when no xcam data present", async () => {
  const { BambuImplementation } = await importBambu();
  const impl = new BambuImplementation(null);
  assert.equal(impl.parseAiDetectionForTests({}), null);
  assert.equal(impl.parseAiDetectionForTests({ xcam: null }), null);
  assert.equal(impl.parseAiDetectionForTests({ xcam: {} }), null);
});

test("parseAiDetection maps xcam flags to enabled state", async () => {
  const { BambuImplementation } = await importBambu();
  const impl = new BambuImplementation(null);

  const data = {
    xcam: {
      spaghetti_detector: true,
      nozzle_clumping_detector: false,
      purgechutepileup_detector: true,
      first_layer_inspector: true,
    },
  };

  const result = impl.parseAiDetectionForTests(data);
  assert.ok(result);
  assert.equal(result.spaghetti.enabled, true);
  assert.equal(result.spaghetti.triggered, false);
  assert.equal(result.nozzle_clumping.enabled, false);
  assert.equal(result.purge_chute_jam.enabled, true);
  assert.equal(result.start_check.enabled, true);
});

test("parseAiDetection marks triggered when xcam_status reports an alert", async () => {
  const { BambuImplementation } = await importBambu();
  const impl = new BambuImplementation(null);

  const data = {
    xcam: { spaghetti_detector: true },
    xcam_status: {
      spaghetti_triggered: true,
      spaghetti_triggered_at: "2026-05-08T10:15:00Z",
    },
  };

  const result = impl.parseAiDetectionForTests(data);
  assert.equal(result.spaghetti.enabled, true);
  assert.equal(result.spaghetti.triggered, true);
  assert.equal(result.spaghetti.last_triggered_at, "2026-05-08T10:15:00Z");
});
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `npm run build && node --test tests/bambu-parsers.test.mjs`

Expected: the three new `parseAiDetection*` tests fail with
`TypeError: impl.parseAiDetectionForTests is not a function`. The Task 3
tests still pass.

- [ ] **Step 4: Implement parseAiDetection**

Add to `BambuImplementation` in `src/printers/bambu.ts`, immediately after
`parseAms2Pro`:

```ts
private parseAiDetection(data: any): AiDetectionStatus | null {
  const xcam = data?.xcam;
  const xcamStatus = data?.xcam_status;
  if ((!xcam || typeof xcam !== "object") && (!xcamStatus || typeof xcamStatus !== "object")) {
    return null;
  }

  // Map of public key -> enabled flag name (xcam) -> triggered flag / ts name (xcam_status)
  const spec: Array<[
    keyof AiDetectionStatus,
    string,
    string,
    string,
  ]> = [
    ["spaghetti",       "spaghetti_detector",             "spaghetti_triggered",       "spaghetti_triggered_at"],
    ["nozzle_clumping", "nozzle_clumping_detector",       "nozzle_clumping_triggered", "nozzle_clumping_triggered_at"],
    ["purge_chute_jam", "purgechutepileup_detector",      "purge_chute_jam_triggered", "purge_chute_jam_triggered_at"],
    ["start_check",     "first_layer_inspector",          "start_check_triggered",     "start_check_triggered_at"],
  ];

  const out: AiDetectionStatus = {};
  let populated = false;

  for (const [key, enabledField, triggeredField, triggeredAtField] of spec) {
    const enabledRaw = xcam?.[enabledField];
    const triggeredRaw = xcamStatus?.[triggeredField];
    const triggeredAtRaw = xcamStatus?.[triggeredAtField];

    if (enabledRaw === undefined && triggeredRaw === undefined) continue;

    const cat: AiDetectionCategory = {
      enabled: Boolean(enabledRaw),
      triggered: Boolean(triggeredRaw),
    };
    if (typeof triggeredAtRaw === "string" && triggeredAtRaw.length > 0) {
      cat.last_triggered_at = triggeredAtRaw;
    }
    out[key] = cat;
    populated = true;
  }

  return populated ? out : null;
}

parseAiDetectionForTests(data: any): AiDetectionStatus | null {
  return this.parseAiDetection(data);
}
```

- [ ] **Step 5: Build and re-run tests**

Run: `npm run build && node --test tests/bambu-parsers.test.mjs`

Expected: all seven tests (four AMS + three AI) pass.

- [ ] **Step 6: Commit**

```bash
git add src/printers/bambu.ts tests/bambu-parsers.test.mjs
git commit -m "feat(bambu): parseAiDetection for xcam flags + triggered state"
```

---

## Task 5: Wire parsers into getStatus

**Files:**
- Modify: `src/printers/bambu.ts`
- Test: `tests/bambu-status.test.mjs` (create)

- [ ] **Step 1: Write a failing getStatus-shape test**

Create `tests/bambu-status.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npm run build && node --test tests/bambu-status.test.mjs`

Expected: all three tests fail because `ams_2_pro` and `ai_detection`
are not yet part of the returned object.

- [ ] **Step 3: Extend getStatus to include the new blocks**

In `src/printers/bambu.ts`, find `getStatus` (around line 167). Inside the
`try` block, just before `return {`, add:

```ts
      const ams_2_pro = this.parseAms2Pro(data);
      const ai_detection = this.parseAiDetection(data);
```

Then update the returned object. Replace the existing `return { ... }`
block (lines ~185-210) with this full replacement (keep all existing
fields, add the two new ones just above `model`):

```ts
      return {
        status: data.gcode_state || "UNKNOWN",
        connected: true,
        temperatures: {
          nozzle: {
            actual: data.nozzle_temper || 0,
            target: data.nozzle_target_temper || 0,
          },
          bed: {
            actual: data.bed_temper || 0,
            target: data.bed_target_temper || 0,
          },
          chamber: data.chamber_temper || data.frame_temper || 0,
        },
        print: {
          filename: data.subtask_name || data.gcode_file || "None",
          progress: data.mc_percent || 0,
          timeRemaining: data.mc_remaining_time || 0,
          currentLayer: data.layer_num || 0,
          totalLayers: data.total_layer_num || 0,
        },
        ams: data.ams || null,
        ams_2_pro,
        ai_detection,
        model: data.model || "Unknown",
        serial,
        raw: data,
      };
```

- [ ] **Step 4: Re-run the tests**

Run: `npm run build && node --test tests/bambu-status.test.mjs`

Expected: all three tests pass.

- [ ] **Step 5: Run the full parser suite and the pre-existing behavior tests**

Run: `npm run build && node --test tests/**/*.test.mjs`

Expected: all tests pass. The existing `tests/behavior.test.mjs` must
still succeed (it does not exercise Bambu, but it spawns the server
process; any accidental import-time regression in `src/index.ts` or
`bambu.ts` will surface here).

- [ ] **Step 6: Commit**

```bash
git add src/printers/bambu.ts tests/bambu-status.test.mjs
git commit -m "feat(bambu): expose ams_2_pro and ai_detection via getStatus"
```

---

## Task 6: Update README with P2S model and new status fields

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add P2S to the env example**

In `README.md`, find line 214:

```
BAMBU_MODEL=p1s                  # REQUIRED for Bambu: p1s, p1p, x1c, x1e, a1, a1mini, h2d
```

Replace with:

```
BAMBU_MODEL=p1s                  # REQUIRED for Bambu: p1s, p1p, p2s, x1c, x1e, a1, a1mini, h2d
```

- [ ] **Step 2: Add P2S to the Bambu Labs section**

In `README.md`, find line 327:

```
- Printer model: **Required** (set `BAMBU_MODEL`). Valid values: `p1s`, `p1p`, `x1c`, `x1e`, `a1`, `a1mini`, `h2d`. This ensures the slicer generates correct G-code for your specific printer.
```

Replace with:

```
- Printer model: **Required** (set `BAMBU_MODEL`). Valid values: `p1s`, `p1p`, `p2s`, `x1c`, `x1e`, `a1`, `a1mini`, `h2d`. This ensures the slicer generates correct G-code for your specific printer.
```

- [ ] **Step 3: Document the new status fields**

Find the "Available Resources" -> "Printer Resources" section (or the
closest section describing Bambu status output). Directly after the
paragraph that describes the existing `printer://bambu/.../status`
shape, add the following subsection. If the exact anchor is hard to find,
add this as a new subsection immediately before the
"Bambu Preset Resources" subsection (line referenced by TOC anchor
`#bambu-preset-resources`):

````markdown
#### Extended Bambu Status Fields

For printers that report them (P2S and newer firmware on P1S / X1 / H2D),
`getStatus` includes two additional blocks:

- `ams_2_pro`: `null` when no AMS 2 Pro-style data is present. When populated:

  ```json
  {
    "units": [
      {
        "id": 0,
        "slots": [
          {
            "slot": 0,
            "humidity_pct": 22,
            "target_humidity_pct": 15,
            "drying_active": true,
            "drying_temp_c": 55,
            "dry_time_remaining_min": 90
          }
        ]
      }
    ]
  }
  ```

- `ai_detection`: `null` when the printer does not expose xcam state.
  When populated, keys `spaghetti`, `nozzle_clumping`, `purge_chute_jam`,
  `start_check` each report:

  ```json
  {
    "enabled": true,
    "triggered": false,
    "last_triggered_at": "2026-05-08T12:00:00Z"
  }
  ```

Both fields are additive. Existing `temperatures`, `print`, `ams`, `model`,
`serial`, and `raw` remain unchanged.
````

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document BAMBU_MODEL=p2s and new status fields"
```

---

## Task 7: Version bump, build, final test, publish

**Files:**
- Modify: `package.json`, `package-lock.json` (via `npm version`)

This task satisfies the project release rule from `CLAUDE.md`:
"Always bump the npm version (`npm version patch`) and `npm publish` after
any change that gets pushed to main".

- [ ] **Step 1: Confirm the working tree is clean except for plan commits**

Run: `git status`

Expected: `nothing to commit, working tree clean`.

- [ ] **Step 2: Full clean build**

Run: `npm run build`

Expected: exit code 0.

- [ ] **Step 3: Full test suite**

Run: `node --test tests/**/*.test.mjs`

Expected: all tests pass (parser tests, status tests, behavior tests).
If behavior tests fail, they are transport-related - investigate before
continuing; do not bump the version with a red CI.

- [ ] **Step 4: Bump version**

Run: `npm version patch -m "chore(release): %s - Bambu P2S support + AMS 2 Pro / AI detection telemetry"`

Expected: `package.json` version is now `1.2.4`, a commit is created,
and a `v1.2.4` git tag is created.

- [ ] **Step 5: Rebuild against the new version**

Run: `npm run build`

Expected: exit code 0.

- [ ] **Step 6: Push the branch and the tag**

Run: `git push origin HEAD && git push origin v1.2.4`

Expected: both pushes succeed.

- [ ] **Step 7: Publish to npm**

Run: `npm publish`

Expected: package published as `mcp-3d-printer-server@1.2.4`. If npm
credentials are not configured on this machine, stop here and tell the
user they need to `npm login` first; the tag and commit are already
pushed, so `npm publish` can run later from any machine.

---

## Verification checklist (run once at the end)

- [ ] `BAMBU_MODEL=p2s` is accepted by validation (grep `VALID_BAMBU_MODELS` in `dist/index.js`).
- [ ] `BAMBU_MODEL_PRESETS.p2s("0.4")` returns `"Bambu Lab P2S 0.4 nozzle"`.
- [ ] P2S appears in the elicitation `oneOf` schema.
- [ ] `getStatus` on a P1S-shape payload returns `ams_2_pro: null` and `ai_detection: null`.
- [ ] `getStatus` on a P2S drying payload returns populated `ams_2_pro`.
- [ ] `getStatus` on an xcam-triggered payload returns populated `ai_detection`.
- [ ] README lists `p2s` in two places (env example and Bambu Labs section).
- [ ] `package.json` version is `1.2.4`.
- [ ] npm tag `v1.2.4` exists and is pushed.
- [ ] `npm publish` succeeded (or user is flagged to run it later).

## Follow-ups (not in this plan)

- Port the same changes to `bambu-printer-mcp` (sibling repo). Safety-critical
  parity is required by `CLAUDE.md`; the port is a mechanical re-apply of
  Tasks 1 and 5 into that repo's copy of `bambu.ts`.
- Validate the Bambu Studio preset string `"Bambu Lab P2S 0.4 nozzle"`
  against a real P2S-exported `.3mf` and file a quick fix if it's off.
- Probe a live P2S once to confirm the MQTT field names for AMS 2 Pro drying
  and xcam status. If different, update the field spec tables in
  `parseAms2Pro` / `parseAiDetection` (parser-only change, no API impact).
- Consider a follow-up that tracks the full `bambu-js` migration (PR #10
  approach) for long-term maintenance once `bambu-js` v3 is on npm.
