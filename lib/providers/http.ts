/** Tiny fetch helper with timeout and JSON handling, shared by the real adapters. */

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly bodyText: string,
  ) {
    super(`HTTP ${status} from ${url}: ${bodyText.slice(0, 300)}`);
  }
}

export interface HttpOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export async function httpJson<T = unknown>(url: string, opts: HttpOptions = {}): Promise<{ status: number; data: T; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: {
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        accept: "application/json, text/plain;q=0.9, */*;q=0.8",
        ...(opts.headers ?? {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, url, text);
    let data: T;
    try {
      data = (text ? JSON.parse(text) : null) as T;
    } catch {
      data = text as unknown as T;
    }
    return { status: res.status, data, text };
  } finally {
    clearTimeout(timer);
  }
}
