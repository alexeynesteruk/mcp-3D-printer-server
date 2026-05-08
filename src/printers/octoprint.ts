import { PrinterImplementation, PrinterFileEntry, PrinterFilesResult } from "../types.js";
import fs from "fs";
import FormData from "form-data";

// Recursively walk an OctoPrint file/folder tree and emit a flat list of entries.
function walkOctoEntries(items: any[]): PrinterFileEntry[] {
  const result: PrinterFileEntry[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const entry: PrinterFileEntry = { name: item.name };
    if (item.path !== undefined) entry.path = item.path;
    if (typeof item.size === "number") entry.size = item.size;
    if (typeof item.date === "number") entry.date = item.date;
    entry.type = item.type === "folder" ? "folder" : "file";
    entry.origin = "local";
    result.push(entry);
    if (Array.isArray(item.children) && item.children.length > 0) {
      result.push(...walkOctoEntries(item.children));
    }
  }
  return result;
}

export function normalizeFiles(raw: any): PrinterFileEntry[] {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    if (!Array.isArray(raw.files)) return [];
    return walkOctoEntries(raw.files);
  } catch {
    return [];
  }
}

export class OctoPrintImplementation extends PrinterImplementation {
  async getStatus(host: string, port: string, apiKey: string) {
    const url = `http://${host}:${port}/api/printer`;
    const response = await this.apiClient.get(url, {
      headers: {
        "X-Api-Key": apiKey
      }
    });
    return response.data;
  }

  async getFiles(host: string, port: string, apiKey: string): Promise<PrinterFilesResult> {
    const url = `http://${host}:${port}/api/files`;
    const response = await this.apiClient.get(url, {
      headers: {
        "X-Api-Key": apiKey
      }
    });
    const raw = response.data;
    const files = normalizeFiles(raw);
    return { files, total: files.length, truncated: false, raw };
  }

  async getFile(host: string, port: string, apiKey: string, filename: string) {
    const url = `http://${host}:${port}/api/files/local/${filename}`;
    const response = await this.apiClient.get(url, {
      headers: {
        "X-Api-Key": apiKey
      }
    });
    return response.data;
  }

  async uploadFile(host: string, port: string, apiKey: string, filePath: string, filename: string, print: boolean) {
    const url = `http://${host}:${port}/api/files/local`;

    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath));
    formData.append("filename", filename);

    if (print) {
      formData.append("print", "true");
    }

    const response = await this.apiClient.post(url, formData as any, {
      headers: {
        "X-Api-Key": apiKey,
        ...formData.getHeaders()
      }
    });

    return response.data;
  }

  async startJob(host: string, port: string, apiKey: string, filename: string) {
    const url = `http://${host}:${port}/api/files/local/${filename}`;

    const response = await this.apiClient.post(url, {
      command: "select",
      print: true
    } as any, {
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json"
      }
    });

    return response.data;
  }

  async cancelJob(host: string, port: string, apiKey: string) {
    const url = `http://${host}:${port}/api/job`;

    const response = await this.apiClient.post(url, {
      command: "cancel"
    } as any, {
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json"
      }
    });

    return response.data;
  }

  async setTemperature(host: string, port: string, apiKey: string, component: string, temperature: number) {
    let url = `http://${host}:${port}/api/printer/tool`;

    const data: Record<string, any> = {};
    if (component === "bed") {
      data.command = "target";
      data.target = temperature;
      url = `http://${host}:${port}/api/printer/bed`;
    } else if (component.startsWith("extruder")) {
      data.command = "target";
      data.targets = {};
      data.targets[component] = temperature;
    } else {
      throw new Error(`Unsupported component: ${component}`);
    }

    const response = await this.apiClient.post(url, data as any, {
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json"
      }
    });

    return response.data;
  }
}
