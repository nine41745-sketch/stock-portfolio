import { trendMark } from '@/lib/trend-mark'

/** Decorative direction mark (the sign in the text already carries the meaning for screen readers). */
export default function TrendMark({ value }: { value: number | null | undefined }) {
  const mark = trendMark(value)
  if (!mark) return null
  return <span aria-hidden="true" className="mr-0.5 text-[10px]">{mark}</span>
}
