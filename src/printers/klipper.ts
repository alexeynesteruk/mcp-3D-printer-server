import { PrinterImplementation, PrinterFileEntry, PrinterFilesResult } from "../types.js";
import fs from "fs";
import FormData from "form-data";

export function normalizeFiles(raw: any): PrinterFileEntry[] {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    if (!Array.isArray(raw.result)) return [];
    const entries: PrinterFileEntry[] = [];
    for (const item of raw.result) {
      if (!item || typeof item !== "object") continue;
      if (typeof item.path !== "string") continue;
      const segments = item.path.split("/");
      const name = segments[segments.length - 1] || item.path;
      const entry: PrinterFileEntry = { name };
      entry.path = item.path;
      if (typeof item.size === "number") entry.size = item.size;
      if (typeof item.modified === "number") entry.date = Math.floor(item.modified);
      entry.type = "file";
      if (segments.length > 1) entry.origin = segments[0];
      entries.push(entry);
    }
    return entries;
  } catch {
    return [];
  }
}

export class KlipperImplementation extends PrinterImplementation {
  async getStatus(host: string, port: string, apiKey: string) {
    const url = `http://${host}:${port}/printer/info`;
    const response = await this.apiClient.get(url);
    return response.data;
  }

  async getFiles(host: string, port: string, apiKey: string): Promise<PrinterFilesResult> {
    const url = `http://${host}:${port}/server/files/list`;
    const response = await this.apiClient.get(url);
    const raw = response.data;
    const files = normalizeFiles(raw);
    return { files, total: files.length, truncated: false, raw };
  }

  async getFile(host: string, port: string, apiKey: string, filename: string) {
    const url = `http://${host}:${port}/server/files/metadata?filename=${encodeURIComponent(filename)}`;
    const response = await this.apiClient.get(url);
    return response.data;
  }

  async uploadFile(host: string, port: string, apiKey: string, filePath: string, filename: string, print: boolean) {
    const url = `http://${host}:${port}/server/files/upload`;

    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath));
    formData.append("filename", filename);

    const response = await this.apiClient.post(url, formData as any, {
      headers: {
        ...formData.getHeaders()
      }
    });

    if (print && response.data.result === "success") {
      await this.startJob(host, port, apiKey, filename);
    }

    return response.data;
  }

  async startJob(host: string, port: string, apiKey: string, filename: string) {
    const url = `http://${host}:${port}/printer/print/start`;

    const response = await this.apiClient.post(url, { filename } as any);

    return response.data;
  }

  async cancelJob(host: string, port: string, apiKey: string) {
    const url = `http://${host}:${port}/printer/print/cancel`;

    const response = await this.apiClient.post(url, null as any);

    return response.data;
  }

  async setTemperature(host: string, port: string, apiKey: string, component: string, temperature: number) {
    const url = `http://${host}:${port}/printer/gcode/script`;

    let gcode;
    if (component === "bed") {
      gcode = `SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=${temperature}`;
    } else if (component === "extruder") {
      gcode = `SET_HEATER_TEMPERATURE HEATER=extruder TARGET=${temperature}`;
    } else {
      throw new Error(`Unsupported component: ${component}`);
    }

    const response = await this.apiClient.post(url, {
      script: gcode
    } as any);

    return response.data;
  }
}
