import { useEffect, useState } from "react";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

// Minimal data-fetch hook: runs `fn` (given an AbortSignal) whenever `deps`
// change, cancels the in-flight request on change/unmount. Kept tiny on purpose
// — no cache, no framework, in the spirit of the zer0space no-dependency UI.
export function useAsync<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const ac = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    fn(ac.signal)
      .then((data) => {
        if (!ac.signal.aborted) setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (ac.signal.aborted) return;
        setState({ data: null, loading: false, error: error as Error });
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
