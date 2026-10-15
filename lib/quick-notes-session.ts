// Serialize route-transition saves before a newly mounted drawer reads its note.
// This queue contains no persistent cache and is never written to browser storage.
let pendingWrites: Promise<void> = Promise.resolve()

type Snapshot = {
  content: string
  loaded: boolean
  loadFailed: boolean
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'
}

export class QuickNotesSession {
  private snapshot: Snapshot = { content: '', loaded: false, loadFailed: false, saveStatus: 'idle' }
  private listeners = new Set<() => void>()
  private saved = ''
  private userId = ''
  private revision: string | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private loading: AbortController | undefined
  private saving: Promise<void> | undefined
  private conflicted = false
  private lastEditAt = 0
  private forceDrain = false

  constructor(private request: typeof fetch = (...args) => fetch(...args), private debounceMs = 1000) {}

  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(update: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...update }
    this.listeners.forEach(listener => listener())
  }

  async load() {
    this.loading?.abort()
    const controller = new AbortController()
    this.loading = controller
    try {
      await pendingWrites
      if (controller.signal.aborted) return
      const response = await this.request('/api/scratchpad', { signal: controller.signal, cache: 'no-store' })
      if (!response.ok) throw new Error('load failed')
      const data = await response.json()
      if (typeof data.content !== 'string' || typeof data.userId !== 'string'
        || !(data.revision === null || typeof data.revision === 'string')) throw new Error('invalid note')
      if (controller.signal.aborted) return
      this.saved = data.content
      this.userId = data.userId
      this.revision = data.revision
      this.conflicted = false
      this.publish({ content: data.content, loaded: true, loadFailed: false, saveStatus: 'idle' })
    } catch {
      if (!controller.signal.aborted) this.publish({ loaded: false, loadFailed: true })
    }
  }

  edit(content: string) {
    if (!this.snapshot.loaded) return
    this.publish({ content, saveStatus: this.conflicted ? 'error' : 'idle' })
    this.lastEditAt = Date.now()
    clearTimeout(this.timer)
    if (!this.conflicted) this.timer = setTimeout(() => { void this.flush(false) }, this.debounceMs)
  }

  hasUnsavedChanges = () => this.snapshot.loaded && this.snapshot.content !== this.saved

  flush(force = true): Promise<void> {
    clearTimeout(this.timer)
    if (force) this.forceDrain = true
    if (this.saving) return this.saving
    if (!this.hasUnsavedChanges() || this.conflicted) return Promise.resolve()
    this.forceDrain = force
    const operation = pendingWrites.then(async () => {
      while (this.hasUnsavedChanges() && !this.conflicted) {
        const remaining = this.lastEditAt + this.debounceMs - Date.now()
        if (!this.forceDrain && remaining > 0) {
          await new Promise(resolve => setTimeout(resolve, remaining))
          continue
        }
        const content = this.snapshot.content
        this.publish({ saveStatus: 'saving' })
        try {
          const response = await this.request('/api/scratchpad', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, userId: this.userId, expectedRevision: this.revision }),
          })
          if ([401, 403, 409].includes(response.status)) this.conflicted = true
          if (!response.ok) throw new Error('save failed')
          const data = await response.json()
          if (typeof data.revision !== 'string') throw new Error('missing revision')
          this.saved = content
          this.revision = data.revision
          this.publish({ saveStatus: this.hasUnsavedChanges() ? 'saving' : 'saved' })
        } catch {
          this.publish({ saveStatus: 'error' })
          break // Retain edits; no retry loop or blind overwrite after a conflict.
        }
      }
    })
    pendingWrites = operation.catch(() => {})
    this.saving = operation.finally(() => { this.saving = undefined })
    return this.saving
  }

  leave() {
    this.loading?.abort()
    // Do not abort a write: it may already have reached Postgres. Drain edits in order.
    void this.flush()
  }
}
