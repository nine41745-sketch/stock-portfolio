/** Grey placeholder block shown while data loads, so the card keeps its size instead of showing a "loading" sentence. */
export default function Skeleton({ className = '', label = 'กำลังโหลดข้อมูล' }: { className?: string; label?: string }) {
  return <div role="status" aria-label={label} className={`skeleton animate-pulse rounded ${className}`} />
}
