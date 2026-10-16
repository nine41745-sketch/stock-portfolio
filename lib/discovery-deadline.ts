/** Discovery owns every request through body consumption; no detached timeout races. */
export interface DiscoveryProviderContext {
  readonly signal: AbortSignal
  canStart(minimumMs?: number): boolean
  run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T>
}
export const DISCOVERY_WORK_BUDGET_MS = 40_000
export const DISCOVERY_PROVIDER_TIMEOUT_MS = 5_000
export const DISCOVERY_MIN_OPERATION_MS = 250

export class DiscoveryDeadline implements DiscoveryProviderContext {
  private readonly controller = new AbortController()
  private readonly deadlineAt: number
  private readonly timer: ReturnType<typeof setTimeout>
  private readonly pending = new Set<Promise<unknown>>()
  private readonly cancel: () => void
  readonly signal = this.controller.signal

  constructor(private readonly parent?: AbortSignal, budgetMs = DISCOVERY_WORK_BUDGET_MS,
    private readonly providerTimeoutMs = DISCOVERY_PROVIDER_TIMEOUT_MS) {
    this.deadlineAt = performance.now() + budgetMs
    this.cancel = () => this.controller.abort(parent?.reason ?? new DOMException('Discovery cancelled', 'AbortError'))
    this.timer = setTimeout(() => this.controller.abort(new DOMException('Discovery work deadline exceeded', 'TimeoutError')), budgetMs)
    if (parent?.aborted) this.cancel()
    else parent?.addEventListener('abort', this.cancel, { once: true })
  }
  canStart(minimumMs = DISCOVERY_MIN_OPERATION_MS): boolean {
    return !this.signal.aborted && this.deadlineAt - performance.now() >= minimumMs
  }
  async run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!this.canStart()) throw new DOMException('Insufficient Discovery budget', 'TimeoutError')
    const controller = new AbortController()
    const cancel = () => controller.abort(this.signal.reason)
    this.signal.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(() => controller.abort(new DOMException('Discovery provider timeout', 'TimeoutError')),
      Math.min(this.providerTimeoutMs, Math.max(1, this.deadlineAt - performance.now())))
    // Await actual provider settlement, including body reads, before releasing ownership.
    const task = Promise.resolve().then(() => { controller.signal.throwIfAborted(); return operation(controller.signal) })
    this.pending.add(task)
    try { return await task }
    finally {
      clearTimeout(timer)
      this.signal.removeEventListener('abort', cancel)
      this.pending.delete(task)
    }
  }
  async close(): Promise<void> {
    clearTimeout(this.timer)
    this.parent?.removeEventListener('abort', this.cancel)
    this.controller.abort(new DOMException('Discovery complete', 'AbortError'))
    await Promise.allSettled([...this.pending])
  }
}

/** The signal remains attached until the response body is consumed or cancelled. */
export async function discoveryFetch<T>(context: DiscoveryProviderContext, url: string,
  read: (response: Response) => Promise<T>): Promise<T> {
  return context.run(async signal => {
    signal.throwIfAborted()
    const response = await fetch(url, { signal, cache: 'no-store' })
    try {
      signal.throwIfAborted()
      if (!response.ok) throw new Error(`Discovery provider HTTP ${response.status}`)
      const value = await read(response)
      signal.throwIfAborted()
      return value
    } finally {
      if (response.body && !response.bodyUsed) await response.body.cancel().catch(() => {})
    }
  })
}

/** Supabase's custom fetch is shared by Auth and REST. Buffer within the owned
 * operation so SDK json/text reads cannot outlive the request/body deadline. */
export function createDeadlineFetch(context: DiscoveryProviderContext): typeof fetch {
  return async (input, init) => context.run(async signal => {
    const inputSignal = input instanceof Request ? input.signal : undefined
    const signals = [signal, init?.signal, inputSignal].filter((value): value is AbortSignal => !!value)
    const combined = AbortSignal.any(signals)
    combined.throwIfAborted()
    const response = await fetch(input, { ...init, signal: combined, cache: 'no-store' })
    try {
      const body = await response.arrayBuffer()
      combined.throwIfAborted()
      return new Response([101, 204, 205, 304].includes(response.status) ? null : body,
        { status: response.status, statusText: response.statusText, headers: response.headers })
    } finally {
      if (response.body && !response.bodyUsed) await response.body.cancel().catch(() => {})
    }
  })
}
