import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

function Placeholder() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-950 text-neutral-100">
      <h1 className="text-2xl font-semibold text-accent">Encore</h1>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Placeholder />
  </StrictMode>,
);
