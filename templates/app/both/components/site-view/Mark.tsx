/* The ApplyRail mark: two rails and a dot. Replace it with your own. */
export default function Mark({ width = 22, height = 16 }: { width?: number; height?: number }) {
  return (
    <svg className="sv-mark" width={width} height={height} viewBox="0 0 22 16" aria-hidden="true">
      <rect x="0" y="3" width="22" height="2" rx="1" fill="currentColor" />
      <rect x="0" y="11" width="22" height="2" rx="1" fill="currentColor" />
      <circle cx="16" cy="8" r="3" fill="var(--accent)" />
    </svg>
  );
}
