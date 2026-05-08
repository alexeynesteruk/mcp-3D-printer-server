# list_printer_files - Normalized Shape + Token Budget Controls

- Status: Approved
- Date: 2026-05-08
- Owner: anesteruk
- Repo: mcp-3D-printer-server
- Refs: DMontgomery40/mcp-3D-printer-server#4

## Background

`list_printer_files` currently returns whatever each adapter's native API returns. OctoPrint's `/api/files` response is the worst offender: a real user reported **324 files, ~500 KB, ~200k tokens** which blew past their 64k input context. The maintainer suggested "use a larger model." The reporter pushed back, correctly: the tool should be trimmable. The upstream issue is still open.

Every adapter returns a different shape. Clients that want "just the filenames" have no portable way to ask for that.

## Goals

1. **Normalized response** across all seven adapters: `{ files: PrinterFileEntry[], total, truncated, raw? }`.
2. **Tool-layer controls** on `list_printer_files`: `limit` (default 50, max 500, `0` = unlimited), `fields` (default `['name','size','date']`), `raw` (default false, includes original adapter payload).
3. **Backward compat escape hatch** via `raw: true`. Anyone who really wanted the old native shape can still get it.
4. **No new MCP tools, no new env vars, no new dependencies.**

## Non-goals

- Redesigning `get_printer_file` or other related tools.
- Live-testing on Creality or Repetier (no hardware access; heuristic + raw passthrough + public-docs-based canned fixtures only).
- Rewriting the tool output as MCP resources.

## Success criteria

1. `npm run build` clean.
2. All existing 14 tests plus new normalization tests (per adapter) plus a new tool-layer integration test pass.
3. Calling `list_printer_files` with default args returns at most 50 entries with `name`, `size`, `date` fields per entry.
4. Calling with `raw: true` includes the original adapter payload under a `raw` key.
5. On a garbage/unknown adapter response, the call returns `{ files: [], total: 0, truncated: false, raw: <original> }` instead of throwing.

## Design

### Types (`src/types.ts`)

```ts
export interface PrinterFileEntry {
  name: string;              // basename (filename only, no path)
  path?: string;             // full path within the printer storage
  size?: number;             // bytes
  date?: number;             // unix epoch seconds (integer)
  type?: "file" | "folder";  // defaults to "file"
  origin?: string;           // optional storage hint, e.g. "local", "sdcard", "cache"
}

export interface PrinterFilesResult {
  files: PrinterFileEntry[];
  total: number;       // how many entries the adapter actually reported
  truncated: boolean;  // true if files.length < total (set by the tool layer, not adapters)
  raw?: any;           // original adapter payload, set by adapters, stripped by default
}
```

The abstract `getFiles` return type in `PrinterImplementation` narrows from `Promise<any>` to `Promise<PrinterFilesResult>`. Every adapter updates.

### Adapter normalizer contract

Every adapter's `getFiles`:

1. Calls the printer API as it does today.
2. Passes the raw response through a private `normalizeFiles(raw): PrinterFileEntry[]` helper.
3. Returns `{ files, total: files.length, truncated: false, raw }`.
4. Wraps the whole thing in try/catch. On parse failure, returns `{ files: [], total: 0, truncated: false, raw: <original or error shape> }`. Never throws.

Per-adapter mapping tables (finalized during implementation; see plan for canned sample fixtures):

| Adapter | Source shape | Mapping |
|---|---|---|
| **OctoPrint** | `/api/files` returns `{ files: [{name, path, type, size, date, children?}], free, total }`. `type` is `"model" \| "machinecode" \| "folder"`. `date` is epoch seconds. Folders have `children`. | Recursive flatten. `name` <- `name`. `path` <- `path`. `size` <- `size`. `date` <- `date`. `type` <- `"folder"` if `type==="folder"` else `"file"`. `origin` <- `"local"` (OctoPrint convention). Emit folder entries AND their children; the tool layer can filter to files-only in a later iteration if needed. |
| **Klipper (Moonraker)** | `/server/files/list` returns `{ result: [{path, modified, size, permissions}] }`. `modified` is epoch seconds (may be fractional). `path` is relative like `"gcodes/benchy.gcode"`. | `name` <- basename. `path` <- `path`. `size` <- `size`. `date` <- `Math.floor(modified)`. `type` <- `"file"`. `origin` <- first segment of `path` (e.g. `"gcodes"`). |
| **Duet (RRF)** | `/machine/file-list` returns `{ dir, files: [{type, name, size, date}] }` for RRF3; `date` is ISO 8601. Older returns a raw array of objects. | Handle both. `name` <- `name`. `size` <- `size`. `date` <- `Math.floor(Date.parse(date)/1000)` if string else number. `type` <- `"folder"` if `type==="d"` else `"file"`. `path` <- `${dir}/${name}` when `dir` is known. |
| **Prusa (PrusaLink / PrusaConnect)** | `/api/v1/files/{storage}` returns `{ children: [{name, type, size, m_timestamp}] }`. `type` is `"FILE" \| "FOLDER"`. Older `/api/files` is OctoPrint-shaped. | Detect shape. For v1: `name` <- `name`, `size` <- `size`, `date` <- `m_timestamp` (already seconds), `type` lowercased. For legacy: use OctoPrint mapping. |
| **Creality** | `/api/storage/list` shape not publicly documented; likely `{ files: [...] }` with strings or objects. | Heuristic: if `response.data.files` is array of strings -> map each to `{name: s}`. If array of objects -> project `{name, path, size, date, type}` when present. Otherwise return `[]` and let `raw` pass through. |
| **Repetier** | `ls` returns `{ dir: string, files: [string \| {name, type, size, date}] }`. | Same heuristic. `origin` <- `dir`. |
| **Bambu** | Current shape `{ files: ["cache/x.gcode", ...], directories: {cache: [...], timelapse: [...], logs: [...]} }`. bambu-js `readDir` only returns names, no size/date. | Flatten directories into entries. `name` <- basename. `path` <- `"dir/name"`. `origin` <- directory. `type` <- `"file"`. No `size`/`date` available. Keep both flat `files` and `directories` in `raw` for back-compat. |

### Tool schema (`src/index.ts`)

Add to `list_printer_files` `inputSchema.properties`:

```ts
limit: {
  type: "number",
  description: "Maximum number of files to return (default: 50, max: 500). Pass 0 for unlimited.",
  default: 50
},
fields: {
  type: "array",
  items: { type: "string", enum: ["name", "path", "size", "date", "type", "origin"] },
  description: "Which fields to include per entry. Default: ['name','size','date']."
},
raw: {
  type: "boolean",
  description: "If true, include the printer's raw response under `raw`. Default false. Can be very large; use for debugging only.",
  default: false
}
```

### Tool handler (`src/index.ts`)

Between `case "list_printer_files":` and the existing call to `this.getPrinterFiles(...)`, introduce a helper `this.projectFilesResult(result, args)`:

```ts
private projectFilesResult(result: PrinterFilesResult, args: any): PrinterFilesResult {
  const rawRequested = Boolean(args?.raw);
  const rawLimit = typeof args?.limit === "number" ? args.limit : 50;
  const limit = rawLimit === 0 ? Infinity : Math.max(0, Math.min(500, rawLimit));
  const defaultFields = ["name", "size", "date"];
  const allowed = ["name", "path", "size", "date", "type", "origin"];
  const requestedFields: string[] = Array.isArray(args?.fields) ? args.fields : defaultFields;
  const fields = requestedFields.filter((f) => allowed.includes(f));

  const all = result.files;
  const truncated = all.length > limit;
  const sliced = Number.isFinite(limit) ? all.slice(0, limit) : all;

  const projected = sliced.map((entry) => {
    const out: any = {};
    for (const f of fields) if (entry[f as keyof PrinterFileEntry] !== undefined) out[f] = (entry as any)[f];
    return out;
  });

  const response: PrinterFilesResult = {
    files: projected,
    total: all.length,
    truncated,
  };
  if (rawRequested) response.raw = result.raw;
  return response;
}
```

Handler: `result = this.projectFilesResult(await this.getPrinterFiles(...), args);`

### Testing

Two new `node --test` files (matches existing `tests/*.test.mjs` style, runs against compiled `dist/`):

1. **`tests/printers-normalize-files.test.mjs`** - canned raw payloads per adapter, assert the mapping to `PrinterFileEntry[]`:
   - OctoPrint: nested `{files:[{type:"folder", children:[...]}]}` - flat output includes both folder and child.
   - Klipper: moonraker-shaped response, `modified` fractional -> integer epoch.
   - Duet: ISO 8601 date string -> integer epoch.
   - Prusa: v1 `children` shape and legacy OctoPrint-shape both normalize.
   - Creality: array of strings -> `[{name}]`; garbage -> `[]` with `raw` preserved.
   - Repetier: mixed array.
   - Bambu: the current `{files, directories}` shape -> flattened entries with `origin`.

2. **`tests/list-printer-files-tool.test.mjs`** - spawn server, `listTools`+`callTool` pattern matching `tests/behavior.test.mjs`. Mocks are injected via a one-off env flag or by stubbing the factory (pattern TBD during implementation, prefer whichever keeps the test self-contained without hitting a real printer).

### Error handling

- Adapter HTTP errors: adapters continue to throw; `getPrinterFiles` in index.ts wraps and re-throws as before. No change to failure semantics.
- Adapter parse errors: caught inside `normalizeFiles`, entry is silently dropped from the result (logged at debug level).
- Unknown adapter: heuristic walk + `raw` passthrough means user gets an empty `files` but the raw payload is always retrievable.
- `limit: 0` explicitly means "no cap" (the tool description calls this out).

### Risks

- **Breaking external callers** who depend on the raw shape. Mitigation: `raw: true`. Documented in README.
- **Creality/Repetier mappings are guesses** without live hardware. Mitigation: graceful heuristic + `raw` passthrough + easy iteration once a real user reports shapes.
- **Silent field drops** if an adapter truly has no `date` or `size`. Mitigation: `PrinterFileEntry` fields are optional; `fields=['name']` always works.

## Rollback

Revert the commit(s). Purely additive at the schema level with `raw:true` preserving legacy behavior, so no data migration concern.

## Open questions

1. Should folders be included in the normalized `files` list or filtered out? Keeping them in with `type:"folder"` for now; a follow-up `include_folders: false` flag could hide them by default if it turns out to be noise.
2. Bambu's bambu-js `readDir` doesn't surface size/date - a future bambu-js v3 migration (see audit report) could add them via `FileController`.
