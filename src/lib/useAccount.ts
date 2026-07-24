import { useEffect, useState } from "react";
import { api } from "./api";

// Whether per-user account features (favourites, progress, continue-watching)
// are available — i.e. the dashboard SSO broker is wired and /account/me works.
// Probed once and cached, so account UI simply hides when SSO is off rather than
// erroring. `null` = still probing.
let cached: boolean | null = null;
let inflight: Promise<boolean> | null = null;

function probe(): Promise<boolean> {
  if (cached !== null) return Promise.resolve(cached);
  if (!inflight) {
    inflight = api
      .me()
      .then(() => {
        cached = true;
        return true;
      })
      .catch(() => {
        cached = false;
        return false;
      });
  }
  return inflight;
}

export function useAccount(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(cached);
  useEffect(() => {
    let live = true;
    probe().then((v) => {
      if (live) setAvailable(v);
    });
    return () => {
      live = false;
    };
  }, []);
  return available;
}
