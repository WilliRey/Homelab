// A bottom action sheet (TrackMenu and friends). Tap the backdrop to close.
import { useEffect } from 'react';

export function ActionSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: React.ReactNode; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative max-h-[80dvh] overflow-y-auto overscroll-contain rounded-t-2xl bg-surface pb-safe shadow-2xl">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line" />
        {title && <div className="border-b border-line px-4 pb-3 pt-2">{title}</div>}
        <div className="py-1">{children}</div>
      </div>
    </div>
  );
}

export function SheetButton({ onClick, children, icon }: { onClick: () => void; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-12 w-full items-center gap-4 px-5 text-left text-[15px] active:bg-raised">
      <span className="w-5 text-muted">{icon}</span>
      {children}
    </button>
  );
}
