import * as https from 'https';
import * as http from 'http';

export interface OllamaModel {
  name: string;
  size: string;
  family: string;
  modifiedAt: string;
}

export class OllamaModels {
  static async fetchAvailable(baseUrl: string): Promise<OllamaModel[]> {
    try {
      const data = await OllamaModels.get(`${baseUrl}/api/tags`);
      const json = JSON.parse(data) as { models: RawModel[] };
      return (json.models ?? []).map(m => ({
        name: m.name,
        size: OllamaModels.formatBytes(m.size),
        family: m.details?.family ?? 'unknown',
        modifiedAt: m.modified_at,
      }));
    } catch {
      return [];
    }
  }

  static async isRunning(baseUrl: string): Promise<boolean> {
    try {
      await OllamaModels.get(`${baseUrl}/api/tags`);
      return true;
    } catch {
      return false;
    }
  }

  private static get(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      client.get(url, { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => resolve(data));
      }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
    });
  }

  private static formatBytes(bytes: number): string {
    if (!bytes) return '';
    const gb = bytes / 1e9;
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    return `${(bytes / 1e6).toFixed(0)} MB`;
  }
}

interface RawModel {
  name: string;
  size: number;
  modified_at: string;
  details?: { family?: string };
}
