/** Encore's own mark: concentric rings. Not based on any other brand. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <circle cx="256" cy="256" r="168" fill="none" stroke="currentColor" strokeWidth="44" />
      <circle cx="256" cy="256" r="84" fill="none" stroke="currentColor" strokeWidth="36" opacity=".55" />
      <circle cx="256" cy="256" r="34" fill="currentColor" />
    </svg>
  );
}
