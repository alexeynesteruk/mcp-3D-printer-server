# Implementation Plan: list_printer_files normalization

- Spec: docs/superpowers/specs/2026-05-08-list-printer-files-normalization.md
- Repo: mcp-3D-printer-server (anesteruk fork of DMontgomery40/mcp-3D-printer-server)
- Working branch: `main` (will push to `anesteruk/mcp-3D-printer-server` then PR to upstream)

## TDD order

Tests first per layer. Two test files:

1. `tests/printers-normalize-files.test.mjs` - per-adapter unit-ish tests against the compiled `dist/printers/*.js`.
2. `tests/list-printer-files-tool.test.mjs` - end-to-end tool test, server spawned, adapter mocked via a `MOCK_PRINTER_FILES_FIXTURE` env hook (pattern adapted from existing `tests/behavior.test.mjs`).

## Tasks

### Task A - types

**Files:** `src/types.ts`

Add `PrinterFileEntry` and `PrinterFilesResult`. Narrow `PrinterImplementation.getFiles` return to `Promise<PrinterFilesResult>`.

**Verification:** `npm run build` may fail because adapters still return `any`-ish shapes. That's fine; the next tasks fix it.

### Task B - normalizer tests (RED)

**Files (new):** `tests/printers-normalize-files.test.mjs`

For each adapter, import its class, monkeypatch the underlying HTTP/network call to return a canned raw fixture, call `getFiles`, assert the resulting `PrinterFilesResult.files`. Fixtures:

- **OctoPrint:** `{files:[{name:"a.gcode",path:"a.gcode",type:"machinecode",size:1234,date:1700000000},{name:"sub",type:"folder",path:"sub",children:[{name:"b.gcode",path:"sub/b.gcode",type:"machinecode",size:5,date:1700000050}]}]}` -> 3 entries (a.gcode, sub folder, sub/b.gcode), folder typed `"folder"`, all dates integer.
- **Klipper:** `{result:[{path:"benchy.gcode",modified:1700000000.5,size:42,permissions:"rw"}]}` -> 1 entry, `name:"benchy.gcode"`, `date:1700000000`, `path:"benchy.gcode"`.
- **Duet:** `{dir:"/gcodes",files:[{type:"f",name:"x.g",size:10,date:"2024-01-02T03:04:05"}]}` -> 1 entry, ISO -> epoch, `path:"/gcodes/x.g"`, `type:"file"`.
- **Prusa v1:** `{children:[{name:"x.bgcode",type:"FILE",size:10,m_timestamp:1700000000}]}` -> 1 entry, type lowercased.
- **Prusa legacy:** OctoPrint-shaped fixture -> normalizes the same as OctoPrint.
- **Creality (string array):** `{files:["a.gcode","b.gcode"]}` -> 2 entries, name only.
- **Creality (garbage):** `"hello"` -> empty files, raw preserved.
- **Repetier:** `{dir:"/sd",files:[{name:"a.g",type:0,size:5,date:1700000000},"b.g"]}` -> 2 entries.
- **Bambu:** `{files:["cache/x.gcode","cache/y.gcode"],directories:{cache:["x.gcode","y.gcode"]}}` -> entries flattened with `origin:"cache"`, `path:"cache/x.gcode"`.

For HTTP-based adapters, the cleanest mock is to stub `axios` via dependency injection. Inspect existing tests for the prevailing pattern - if there isn't one, override the adapter's `axios` import via a small test-only setter, OR inject the mock through the existing config (`apiClient`-style). **Discover during execution; pick the approach that requires the smallest diff.**

If injection turns out to require restructuring the adapters significantly, fall back to: extract `normalizeFiles` to a pure exported function per adapter, test that function directly, and rely on Task E for the integration coverage. **This fallback is acceptable** and is the more idiomatic split anyway.

**Decision rule:** if the test file approaches 200 lines of mock plumbing, switch to the pure-function approach.

### Task C - adapter normalizers (GREEN)

**Files:** `src/printers/octoprint.ts`, `klipper.ts`, `duet.ts`, `prusa.ts`, `creality.ts`, `repetier.ts`, `bambu.ts`

Each gets:

```ts
private normalizeFiles(raw: any): PrinterFileEntry[] { ... }
```

(or exported pure function if Task B chose that path) and a rewritten `getFiles` that returns `PrinterFilesResult`. Implement per the mapping table in the spec.

**Verification:** `npm run build && node --test tests/printers-normalize-files.test.mjs` green.

### Task D - tool schema + handler

**Files:** `src/index.ts`

1. Extend `list_printer_files` `inputSchema.properties` with `limit`, `fields`, `raw`.
2. Add `private projectFilesResult(...)` per spec.
3. Update the `case "list_printer_files":` handler to call `projectFilesResult(await this.getPrinterFiles(...), args)`.

**Verification:** `npm run build` clean, existing tests still green.

### Task E - tool integration test

**Files (new):** `tests/list-printer-files-tool.test.mjs`

Spawn the server with `MCP_FAKE_PRINTER=1` (a new test-only env var) and have a tiny fake printer adapter return a fixed `PrinterFilesResult` with 100 entries. The fake adapter is registered inside `index.ts` only when `MCP_FAKE_PRINTER` is truthy (gated, low risk). Tests:

- Default args: returns 50 entries, each with only `name`, `size`, `date`. `total === 100`. `truncated === true`. No `raw`.
- `limit: 5`: returns 5 entries, `truncated === true`.
- `limit: 0`: returns all 100, `truncated === false`.
- `fields: ["name"]`: each entry has only `name`.
- `raw: true`: response includes `raw` key.

Pattern: copy the harness from `tests/behavior.test.mjs` (server spawn, `mcp.json` config, list_tools / call_tool flow).

If gating a fake adapter inside `index.ts` is too invasive, the alternative is to test `projectFilesResult` directly by exporting it from a small helper module and unit-testing the projection. Pick whichever keeps the diff smaller; integration is preferred for confidence.

**Verification:** all tests green.

### Task F - README

**Files:** `README.md`

Add a short section under `list_printer_files` documenting the new shape, `limit`, `fields`, `raw`. Note the breaking change with the `raw: true` escape hatch.

### Task G - final review + push

1. `npm run build`
2. `npm test` (all suites)
3. `git log --oneline origin/main..HEAD` - confirm commits look clean.
4. `git push fork main` (where `fork` = anesteruk/mcp-3D-printer-server).
5. Open PR with `gh pr create --repo DMontgomery40/mcp-3D-printer-server --base main --head anesteruk:main`.

## Commit boundaries

Squash candidates per task; aim for one commit per Task A/C/D/E/F plus the spec/plan commits already in place. Task B's tests + Task C's implementation may merge into a single commit if the diff is small.

## Verification commands

```sh
npm run build
node --test tests/*.test.mjs
```

Both must pass before push.
