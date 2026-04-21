import { exec } from 'child_process';

export interface ThreadInfo {
  id: string;
  created: string;
  snippet: string;
}

export class SessionManager {
  static listThreads(bin: string): Promise<ThreadInfo[]> {
    return new Promise(resolve => {
      exec(`${bin} threads list --json`, { timeout: 8000 }, (err, stdout) => {
        if (err) { resolve([]); return; }
        try {
          const raw = JSON.parse(stdout.trim());
          resolve(Array.isArray(raw) ? raw.map(SessionManager.norm) : []);
        } catch { resolve([]); }
      });
    });
  }

  private static norm(r: Record<string, unknown>): ThreadInfo {
    return {
      id: String(r.id ?? r.thread_id ?? ''),
      created: String(r.created_at ?? r.created ?? ''),
      snippet: String(r.last_message ?? r.summary ?? '').slice(0, 80),
    };
  }
}
