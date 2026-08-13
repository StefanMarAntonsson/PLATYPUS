const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const MAX_BACKOFF_MS = 8_000;

export function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

// Honor the server's Retry-After (seconds or HTTP date) when present, otherwise
// fall back to exponential backoff: 1s, 2s, 4s … capped at MAX_BACKOFF_MS.
function retryDelayMs(res: Response, attempt: number): number {
  const header = res.headers.get("Retry-After");
  if (header) {
    const secs = Number(header);
    if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  return Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
}

export interface FetchRetryOptions extends RequestInit {
  timeoutMs?: number;
  maxRetries?: number;
}

// fetch with a per-attempt timeout and automatic retry on rate-limit (429) and
// transient server errors (5xx), respecting the Retry-After header. The caller's
// AbortSignal cancels both the request and any pending backoff. Non-retryable
// responses (including the final attempt) are returned as-is for the caller to
// inspect via res.ok / res.status.
export async function fetchWithRetry(
  url: string,
  options: FetchRetryOptions = {},
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    signal,
    ...init
  } = options;

  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw signal.reason;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    const res = await fetch(url, { ...init, signal: combined });
    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      await sleep(retryDelayMs(res, attempt), signal);
      continue;
    }
    return res;
  }
}
