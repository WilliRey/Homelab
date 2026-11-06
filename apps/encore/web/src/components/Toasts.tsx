import { useToasts } from '../toast';

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4 pt-safe" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className="pointer-events-auto mt-2 max-w-md rounded-xl bg-fg px-4 py-3 text-sm text-bg shadow-lg"
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}
