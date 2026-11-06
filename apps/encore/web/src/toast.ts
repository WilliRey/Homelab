import { create } from 'zustand';

type Toast = { id: number; text: string };
type ToastState = { toasts: Toast[]; push: (text: string) => void; dismiss: (id: number) => void };

let seq = 0;
export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (text) => {
    const id = ++seq;
    set({ toasts: [...get().toasts.slice(-2), { id, text }] });
    // Visual only: if the page is hidden the toast simply stays until it's seen.
    setTimeout(() => get().dismiss(id), 4000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = (text: string) => useToasts.getState().push(text);
