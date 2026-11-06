import { useCallback, useEffect, useRef, useState } from 'react';
import type { Page } from '../types';

/** Load a paged list; `key` changes reset it. */
export function usePaged<T>(key: string | null, fetchPage: (next?: string) => Promise<Page<T>>) {
  const [items, setItems] = useState<T[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gen = useRef(0);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  const load = useCallback((cursor?: string) => {
    const my = ++gen.current;
    setLoading(true);
    setError(null);
    fetchRef
      .current(cursor)
      .then((p) => {
        if (my !== gen.current) return;
        setItems((prev) => (cursor ? [...prev, ...p.items] : p.items));
        setNext(p.next);
      })
      .catch((e: Error) => my === gen.current && setError(e.message))
      .finally(() => my === gen.current && setLoading(false));
  }, []);

  useEffect(() => {
    setItems([]);
    setNext(undefined);
    if (key !== null) load();
    else gen.current++;
  }, [key, load]);

  return { items, next, loading, error, more: () => next && !loading && load(next), reload: () => load() };
}
