import { PrinterImplementation, PrinterFileEntry, PrinterFilesResult } from "../types.js";
import fs from "fs";
import FormData from "form-data";

export function normalizeFiles(raw: any): PrinterFileEntry[] {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    if (!Array.isArray(raw.files)) return [];

    // Strip the leading slash from dir to use as origin (e.g. "/sd" -> "sd")
    const origin: string | undefined =
      typeof raw.dir === "string" ? raw.dir.replace(/^\/+/, "") || undefined : undefined;

    const entries: PrinterFileEntry[] = [];
    for (const item of raw.files) {
      if (typeof item === "string") {
        const entry: PrinterFileEntry = { name: item };
        if (origin !== undefined) entry.origin = origin;
        entries.push(entry);
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const entry: PrinterFileEntry = { name: item.name };
      if (item.path !== undefined) entry.path = item.path;
      if (typeof item.size === "number") entry.size = item.size;
      if (typeof item.date === "number") entry.date = item.date;
      // Repetier type: 0 = file, 1 = folder (undocumented; treat 0 as file)
      if (typeof item.type === "number") {
        entry.type = item.type === 1 ? "folder" : "file";
      } else if (typeof item.type === "string") {
        entry.type = item.type === "folder" ? "folder" : "file";
      }
      if (origin !== undefined) entry.origin = origin;
      entries.push(entry);
    }
    return entries;
  } catch {
    return [];
  }
}

export class RepetierImplementation extends PrinterImplementation {
  async getStatus(host: string, port: string, apiKey: string) {
    const url = `http://${host}:${port}/printer/api/?a=getPrinterInfo&apikey=${apiKey}`;
    const response = await this.apiClient.get(url);
    return response.data;
  }

  async getFiles(host: string, port: string, apiKey: string): Promise<PrinterFilesResult> {
    const url = `http://${host}:${port}/printer/api/?a=ls&apikey=${apiKey}`;
    const response = await this.apiClient.get(url);
    const raw = response.data;
    const files = normalizeFiles(raw);
    return { files, total: files.length, truncated: false, raw };
  }

  async getFile(host: string, port: string, apiKey: string, filename: string) {
    const url = `http://${host}:${port}/printer/api/?a=getFileInfo&apikey=${apiKey}&filename=${encodeURIComponent(filename)}`;
    const response = await this.apiClient.get(url);
    return response.data;
  }

  async uploadFile(host: string, port: string, apiKey: string, filePath: string, filename: string, print: boolean) {
    const url = `http://${host}:${port}/printer/api/`;

    const formData = new FormData();
    formData.append("a", "upload");
    formData.append("apikey", apiKey);
    formData.append("filename", filename);
    formData.append("print", print ? "1" : "0");
    formData.append("file", fs.createReadStream(filePath));

    const response = await this.apiClient.post(url, formData as any, {
      headers: {
        ...formData.getHeaders()
      }
    });

    return response.data;
  }

  async startJob(host: string, port: string, apiKey: string, filename: string) {
    const url = `http://${host}:${port}/printer/api/?a=startJob&apikey=${apiKey}&filename=${encodeURIComponent(filename)}`;
    const response = await this.apiClient.get(url);
    return response.data;
  }

  async cancelJob(host: string, port: string, apiKey: string) {
    const url = `http://${host}:${port}/printer/api/?a=stopJob&apikey=${apiKey}`;
    const response = await this.apiClient.get(url);
    return response.data;
  }

  async setTemperature(host: string, port: string, apiKey: string, component: string, temperature: number) {
    let url;
    if (component === "bed") {
      url = `http://${host}:${port}/printer/api/?a=setBedTemp&apikey=${apiKey}&temp=${temperature}`;
    } else if (component === "extruder") {
      url = `http://${host}:${port}/printer/api/?a=setExtruderTemp&apikey=${apiKey}&temp=${temperature}`;
    } else {
      throw new Error(`Unsupported component: ${component}`);
    }

    const response = await this.apiClient.get(url);
    return response.data;
  }
}
