"use client";

import { useCallback, useEffect, useState } from "react";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // private windows: the choice just isn't kept
  }
}

/**
 * A choice this browser keeps between visits (a board, a view, a portfolio). The value is undefined
 * until it has been read (just after the first render), then the kept text or null. Wait for it
 * before fetching what depends on it, so a page doesn't load the default first and the kept one after.
 */
export function useRemembered(key: string) {
  const [value, setValue] = useState<string | null>();
  useEffect(() => setValue(read(key)), [key]);
  const set = useCallback(
    (v: string | null) => {
      setValue(v);
      write(key, v);
    },
    [key],
  );
  return [value, set] as const;
}
