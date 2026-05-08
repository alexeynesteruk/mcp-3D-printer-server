# Bambu P2S Support + AMS 2 Pro / AI Detection Telemetry

- Status: Approved (pending user review of this file)
- Date: 2026-05-08
- Owner: anesteruk
- Repo: mcp-3D-printer-server
- Companion repo: bambu-printer-mcp (port in a follow-up)

## Background

`mcp-3D-printer-server` exposes Bambu Lab printers over MCP via
`src/printers/bambu.ts`. Today it validates `BAMBU_MODEL` against
`["p1s", "p1p", "x1c", "x1e", "a1", "a1mini", "h2d"]` in `src/index.ts`
and maps each model to a Bambu Studio preset for slicing. The P2S (released
2026) is missing, so `BAMBU_MODEL=p2s` fails validation. Status output is
also P1S/X1C-era: it surfaces nozzle/bed/chamber temps and progress, but
not the P2S's headline runtime features - AMS 2 Pro humidity and drying
state, and the AI error detection pipeline (spaghetti, nozzle clumping,
purge chute jam, start-check).

Two upstream libraries matter here:

- `bambu-node` (used today): archived October 2025. No P2S-specific work
  will ever land there.
- `bambu-js` (AndrewLemons, v3, not yet on npm): actively maintained,
  splits PrinterController / FileController / CameraController, but currently
  only defines P1S and H2D models. A prior PR (#10) proposed migrating this
  repo to `bambu-js` for H2D support and was closed without merging.

## Goals

Enable `BAMBU_MODEL=p2s` end-to-end on the existing `bambu-node` stack, and
enrich `getStatus` for any Bambu printer that reports AMS 2 Pro humidity /
drying or AI detection fields.

**Success criteria:**

1. `BAMBU_MODEL=p2s` passes `validateBambuModel` and returns a working Bambu
   Studio preset from `BAMBU_MODEL_PRESETS`.
2. `getStatus` for a P2S returns:
   - Existing `temperatures.chamber` (already present via
     `data.chamber_temper || data.frame_temper`).
   - New `ams_2_pro` (per-slot humidity and drying state, when reported).
   - New `ai_detection` (status of the 4 known AI categories, when reported).
   Existing consumers of `status` / `temperatures` / `print` / `ams` /
   `model` / `serial` / `raw` see no breaking change.
3. Tests cover the new paths with mocked MQTT data (no live printer required).
4. README documents `BAMBU_MODEL=p2s` and the new status fields.
5. `npm run build` is clean; `node --test tests/**/*.test.mjs` passes; a
   patch-level `npm version` + `npm publish` accompanies the merge
   (project release rule).

## Non-goals (explicitly deferred)

- Full `bambu-js` migration (the PR #10 path).
- Camera / liveview snapshot tool.
- 3MF AMS-mapping UX changes beyond what `print_3mf` already does.
- Porting the change to the sibling `bambu-printer-mcp` repo (tracked as a
  follow-up; safety-critical changes only need duplication once they exist).
- Adding new MCP tools or MCP resources. The enrichment rides the existing
  `get_printer_status` tool.

## P2S hardware assumptions (from bambulab.com/en/p2s wiki intro, captured 2026-05-08)

- CoreXY, printable area 256 x 256 mm (Z envelope same family as P1S).
- Nozzle max 300 C, bed max 110 C.
- No active chamber heater - passive heat preservation via the Adaptive
  Airflow System. Chamber temperature is sensed and reportable via
  `chamber_temper`.
- Hardened steel 1-clip quick-swap hotend, PMSM servo extruder, eddy-current
  pressure sensor, 1080p liveview camera, 2 TOPS NPU for AI detection.
- Default plate: textured PEI. Also supports smooth PEI and low-temp plates.
  The existing `VALID_BED_TYPES` (`textured_plate`, `cool_plate`,
  `engineering_plate`, `hot_plate`) already covers this set.
- AMS 2 Pro: adds filament drying with electromagnetic active venting,
  per-slot humidity, adjustable target humidity and dry time.

## Design

### Component 1 - `src/index.ts` (validation + preset)

Change the `VALID_BAMBU_MODELS` tuple and the `BAMBU_MODEL_PRESETS` map:

```ts
const VALID_BAMBU_MODELS = [
  "p1s", "p1p", "p2s", "x1c", "x1e", "a1", "a1mini", "h2d",
] as const;

const BAMBU_MODEL_PRESETS: Record<string, (nozzle: string) => string> = {
  p1s:    (n) => `Bambu Lab P1S ${n} nozzle`,
  p1p:    (n) => `Bambu Lab P1P ${n} nozzle`,
  p2s:    (n) => `Bambu Lab P2S ${n} nozzle`,  // NEW
  x1c:    (n) => `Bambu Lab X1 Carbon ${n} nozzle`,
  x1e:    (n) => `Bambu Lab X1E ${n} nozzle`,
  a1:     (n) => `Bambu Lab A1 ${n} nozzle`,
  a1mini: (n) => `Bambu Lab A1 mini ${n} nozzle`,
  h2d:    (n) => `Bambu Lab H2D ${n} nozzle`,
};
```

No changes to `validateBambuModel` or `resolveBedType`. The preset string
follows the same `"Bambu Lab <MODEL> <NOZZLE> nozzle"` convention as every
other entry; it is verifiable by inspecting any P2S-exported
`.3mf` file's `Metadata/project_settings.config` and can be corrected later
without a schema change.

### Component 2 - `src/printers/bambu.ts` (status enrichment)

Extend `getStatus` additively. The returned shape becomes:

```ts
{
  status: string,
  connected: boolean,
  temperatures: { nozzle, bed, chamber },        // unchanged
  print: { filename, progress, timeRemaining, currentLayer, totalLayers },
  ams: any | null,                               // unchanged (raw AMS block)
  ams_2_pro: Ams2ProStatus | null,               // NEW
  ai_detection: AiDetectionStatus | null,        // NEW
  model: string,
  serial: string,
  raw: any,                                      // unchanged, still useful
}
```

Add two private helpers, one type each, and two parsers:

```ts
interface Ams2ProSlotStatus {
  slot: number;                   // 0..3
  humidity_pct?: number;          // current humidity % when reported
  target_humidity_pct?: number;   // set-point when drying
  drying_active?: boolean;
  dry_time_remaining_min?: number;
  drying_temp_c?: number;
}

interface Ams2ProStatus {
  units: Array<{
    id: number;                   // 0 for single AMS, 0..3 for cascades
    slots: Ams2ProSlotStatus[];
  }>;
}

interface AiDetectionCategory {
  enabled: boolean;               // feature flag reported by printer
  triggered: boolean;             // currently reporting a problem
  last_triggered_at?: string;     // ISO timestamp if we can derive one
}

interface AiDetectionStatus {
  spaghetti?: AiDetectionCategory;
  nozzle_clumping?: AiDetectionCategory;
  purge_chute_jam?: AiDetectionCategory;
  start_check?: AiDetectionCategory;
}

private parseAms2Pro(data: any): Ams2ProStatus | null { ... }
private parseAiDetection(data: any): AiDetectionStatus | null { ... }
```

Both parsers are **defensive**: if the source field is absent or malformed,
the parser returns `null` (for the whole block) or omits the specific
sub-field. They never throw. The existing `raw: data` in the response is
the escape hatch for anything we missed.

#### Source fields (best-effort, to be refined against a real P2S payload)

The implementation plan is to probe `printer.data` against a real P2S (user
has one) by logging `raw` once, then map fields. Current best guesses based
on OpenBambuAPI docs, bambu-node type stubs, and reports from bambu-js
users:

**AMS 2 Pro:**
- `data.ams.ams[i].humidity` (legacy, 0-5 scale) vs
  `data.ams.ams[i].humidity_raw` or `humidity_pct` (newer firmware).
- `data.ams.ams[i].tray[j].drying` / `dry_state` / `dry_temp` / `dry_time`.
- Fall back to `null` for the whole `ams_2_pro` block when the first P2S
  report lacks any drying-specific key, so the status call stays lossless.

**AI detection:**
- `data.xcam.allow_skip_parts`, `data.xcam.buildplate_marker_detector`,
  `data.xcam.first_layer_inspector`, `data.xcam.printing_monitor`,
  `data.xcam.spaghetti_detector`, `data.xcam.purgechutepileup_detector`.
  These are the enabled-flags.
- `data.xcam_status` or `data.hms` for triggered state. HMS codes
  `0500-0100-0002-0001` style indicate AI triggers; we surface the boolean
  without decoding the full HMS table.

If the probe reveals different field names, fix in the parser only -
no interface change needed.

### Component 3 - `tests/bambu-status.test.mjs` (new)

A `node --test` file, following the existing `tests/behavior.test.mjs`
style, covering:

1. P1S-shape payload -> `ams_2_pro === null`, `ai_detection === null`,
   old fields unchanged.
2. P2S-shape payload with AMS 2 Pro humidity + drying active ->
   `ams_2_pro.units[0].slots[...]` populated correctly.
3. P2S-shape payload with `xcam.spaghetti_detector: true` and a triggered
   flag -> `ai_detection.spaghetti.enabled === true`, `.triggered === true`.
4. Missing-field payload (empty object) -> `getStatus` returns
   `connected: false` or a well-formed object, no throw.

Tests run against the compiled `dist/printers/bambu.js` to match the
repo's testing rule ("Tests use the compiled `dist/index.js`"). They mock
`BambuClient` via a minimal stub - `executeCommand()` is a no-op,
`data` is the canned payload.

### Component 4 - README + CLAUDE.md touch-ups

- Add `p2s` to the supported `BAMBU_MODEL` list in README.
- Add a short "AMS 2 Pro and AI detection status" section under the Bambu
  resource docs showing sample `getStatus` output with the new fields.
- CLAUDE.md: add a line under the Architecture section noting the new
  parsers are defensive and that raw payload remains authoritative.

## Data flow

```
MCP client
  -> tool: get_printer_status
  -> printer-factory (PRINTER_TYPE=bambu) -> BambuImplementation.getStatus
  -> BambuClientStore.getPrinter(host, serial, token)   [cached MQTT client]
  -> BambuClient.executeCommand(PushAllCommand)          [warm-up, swallow err]
  -> data = printer.data                                 [cached MQTT state]
  -> existing temps/print/ams extraction
  -> parseAms2Pro(data) -> ams_2_pro | null              [NEW]
  -> parseAiDetection(data) -> ai_detection | null       [NEW]
  -> response
```

No new env vars. No new MCP tools or resources. Client decides poll
frequency.

## Error handling & risks

- **Unknown MQTT fields on P2S.** Parsers return `null`; `getStatus` still
  succeeds. `raw:` remains the escape hatch. One-time debug log when
  `data.model === "P2S"` and both parsers return `null`, to help us iterate.
- **`bambu-node` archival.** Shelf-life concern only; functionality is not
  blocked today. README gains a note that the library is archived and that
  migration to `bambu-js` is tracked as a separate effort (Approach B, out
  of scope for this spec).
- **Preset string drift.** If `"Bambu Lab P2S 0.4 nozzle"` doesn't match
  Bambu Studio's actual preset name, slicing breaks for P2S only. Mitigation:
  README troubleshooting note. A future `BAMBU_MODEL_PRESET_OVERRIDE` env
  var is a clean follow-up, not part of this spec.
- **Safety gate unchanged.** `BAMBU_MODEL` is still required for print ops
  and still uses MCP elicitation when missing. Wrong model = wrong G-code =
  hardware damage, per CLAUDE.md. Adding `p2s` to the valid list does not
  weaken this gate.

## Testing & verification

- `npm run build` (tsc) clean.
- `node --test tests/**/*.test.mjs` passes, including new
  `bambu-status.test.mjs`.
- (Optional, post-merge) Manual smoke on the user's P2S: log `raw`,
  confirm `ams_2_pro` and `ai_detection` populate sensibly. Not a merge
  gate since CI has no P2S hardware.

## Release

- `npm version patch` -> 1.2.4.
- `npm publish`.
- Commit the version bump and push in the same operation, per CLAUDE.md.

## Open questions

1. Exact MQTT field names for AMS 2 Pro drying and AI detection on a real
   P2S. Resolved at implementation time by probing `printer.data`.
2. Exact Bambu Studio preset string for P2S. Best-effort assumed; verifiable
   from any P2S-exported `.3mf`.
3. When to port to the sibling `bambu-printer-mcp` repo. Tracked as a
   follow-up PR immediately after this one merges.

## Rollback

Revert the version bump commit. No migrations, no data, no config changes.
Additive-only status enrichment means no client will have taken a
dependency on the new fields being non-null.
