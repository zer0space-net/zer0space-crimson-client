// Incremental NDJSON reader for the backend's progressive /watch response.
//
// The backend flushes one JSON object per line as each source resolves
// (meta → stream* → done), with `X-Accel-Buffering: no` so the reverse proxy
// passes lines through immediately. We yield each parsed object the moment its
// newline arrives, so the UI can surface a source tile before the next one is
// even resolved.

export async function* readNdjson<T = unknown>(
  res: Response,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) yield JSON.parse(line) as T;
      }
    }
    const tail = buffer.trim();
    if (tail) yield JSON.parse(tail) as T;
  } finally {
    reader.cancel().catch(() => {});
  }
}
