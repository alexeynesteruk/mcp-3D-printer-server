import { PrinterImplementation, PrinterFileEntry, PrinterFilesResult } from "../types.js";
import fs from "fs";
import FormData from "form-data";

function parseDuetDate(value: any): number | undefined {
  if (typeof value === "number") return Math.floor(value);
  if (typeof value === "string" && value.length > 0) {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return Math.floor(ms / 1000);
  }
  return undefined;
}

export function normalizeFiles(raw: any): PrinterFileEntry[] {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    if (!Array.isArray(raw.files)) return [];

    const dir: string | undefined = typeof raw.dir === "string" ? raw.dir : undefined;
    const originSegments = dir ? dir.split("/").filter(Boolean) : [];
    const origin = originSegments.length > 0 ? originSegments[0] : undefined;

    const entries: PrinterFileEntry[] = [];

    for (const item of raw.files) {
      if (typeof item === "string") {
        // Older RRF returned plain strings
        entries.push({ name: item, type: "file" });
        continue;
      }
      if (!item || typeof item !== "object") continue;

      const entry: PrinterFileEntry = { name: item.name };
      entry.type = item.type === "d" ? "folder" : "file";
      if (typeof item.size === "number") entry.size = item.size;
      const date = parseDuetDate(item.date);
      if (date !== undefined) entry.date = date;
      if (dir !== undefined) entry.path = `${dir}/${item.name}`;
      if (origin !== undefined) entry.origin = origin;
      entries.push(entry);
    }

    return entries;
  } catch {
    return [];
  }
}

export class DuetImplementation extends PrinterImplementation {
  async getStatus(host: string, port: string, apiKey: string) {
    const url = `http://${host}:${port}/machine/status`;
    const response = await this.apiClient.get(url);
    return response.data;
  }

  async getFiles(host: string, port: string, apiKey: string): Promise<PrinterFilesResult> {
    const url = `http://${host}:${port}/machine/file-list`;
    const response = await this.apiClient.get(url);
    const raw = response.data;
    const files = normalizeFiles(raw);
    return { files, total: files.length, truncated: false, raw };
  }

  async getFile(host: string, port: string, apiKey: string, filename: string) {
    const url = `http://${host}:${port}/machine/file/${encodeURIComponent(filename)}`;
    const response = await this.apiClient.get(url);
    return response.data;
  }

  async uploadFile(host: string, port: string, apiKey: string, filePath: string, filename: string, print: boolean) {
    const url = `http://${host}:${port}/machine/file-upload`;

    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath));
    formData.append("filename", filename);

    const response = await this.apiClient.post(url, formData as any, {
      headers: {
        ...formData.getHeaders()
      }
    });

    if (print && response.data.err === 0) {
      await this.startJob(host, port, apiKey, filename);
    }

    return response.data;
  }

  async startJob(host: string, port: string, apiKey: string, filename: string) {
    const url = `http://${host}:${port}/machine/code`;

    const response = await this.apiClient.post(url, {
      code: `M32 "${filename}"`
    } as any);

    return response.data;
  }

  async cancelJob(host: string, port: string, apiKey: string) {
    const url = `http://${host}:${port}/machine/code`;

    const response = await this.apiClient.post(url, {
      code: "M0"
    } as any);

    return response.data;
  }

  async setTemperature(host: string, port: string, apiKey: string, component: string, temperature: number) {
    const url = `http://${host}:${port}/machine/code`;

    let gcode;
    if (component === "bed") {
      gcode = `M140 S${temperature}`;
    } else if (component === "extruder") {
      gcode = `M104 S${temperature}`;
    } else {
      throw new Error(`Unsupported component: ${component}`);
    }

    const response = await this.apiClient.post(url, {
      code: gcode
    } as any);

    return response.data;
  }
}
