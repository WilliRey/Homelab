// ADAPTER: the only module that spawns yt-dlp (and its JS runtime, Deno).
import { spawn } from 'node:child_process';

export type RunResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean };

/** Spawn with an argument array (never a shell string). Kills the process after `timeoutMs`. */
export function run(cmd: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String(err), timedOut: false });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(err), timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

export async function ytdlpVersion(): Promise<string | null> {
  const r = await run('yt-dlp', ['--version'], 10_000);
  return r.code === 0 ? r.stdout.trim() : null;
}

export async function denoVersion(): Promise<string | null> {
  const r = await run('deno', ['--version'], 10_000);
  if (r.code !== 0) return null;
  return /deno (\S+)/.exec(r.stdout)?.[1] ?? r.stdout.split('\n')[0]!.trim();
}
