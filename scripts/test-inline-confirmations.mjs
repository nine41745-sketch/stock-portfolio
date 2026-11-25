import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// v1.41.55: native window.confirm/prompt/alert are silently blocked in embedded browsers, so the click looks like it did nothing.
// Confirmations now live in the page (components/ui/ConfirmPanel.tsx). TradingJournal keeps its three native confirms on purpose:
// they guard browser navigation (click/popstate/change capture handlers) and must answer synchronously.

const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const count = (source, needle) => source.split(needle).length - 1
const NATIVE = /window\.(confirm|prompt|alert)\(/

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
  })
}

// ---------- no native dialog anywhere except the documented TradingJournal exception ----------
const offenders = ['app', 'components', 'lib']
  .flatMap(walk)
  .map(file => file.split(path.sep).join('/'))
  .filter(file => NATIVE.test(read(file)))
assert.deepEqual(offenders, ['components/portfolio/TradingJournal.tsx'], 'only TradingJournal may keep native dialogs')
assert.equal(count(read('components/portfolio/TradingJournal.tsx'), 'window.confirm('), 3, 'TradingJournal navigation guards stay unchanged')

// ---------- shared panel ----------
const panel = read('components/ui/ConfirmPanel.tsx')
assert.ok(panel.includes('role="alertdialog"') && panel.includes('aria-label={ariaLabel}'), 'panel is an accessible alert dialog')
assert.ok(panel.includes('autoFocus') && panel.includes("event.key !== 'Escape'"), 'panel focuses cancel first and closes on Escape')
assert.ok(panel.includes('event.preventDefault()') && panel.includes('event.stopPropagation()'), 'Escape must not also close a parent dialog')
assert.ok(panel.includes('opener.focus()') && panel.includes('opener.isConnected'), 'panel returns focus to the opener when it still exists')

// ---------- real trade recording keeps one atomic call behind the confirm button ----------
const exec = read('components/portfolio/TradePlanExecutionPanel.tsx')
assert.ok(exec.includes("import ConfirmPanel from '@/components/ui/ConfirmPanel'"), 'execution panel uses the shared confirmation')
assert.equal(count(exec, "fetch('/api/trade-plans/execute'"), 1, 'exactly one execute call')
assert.ok(exec.indexOf("fetch('/api/trade-plans/execute'") > exec.indexOf('async function executeTrade'), 'the execute call lives inside executeTrade')
assert.equal(count(exec, 'void executeTrade()'), 1, 'executeTrade is started from the confirm button only')
assert.equal(count(exec, 'executeTrade'), 2, 'executeTrade has one declaration and one call site')
const submitBody = exec.slice(exec.indexOf('function submit('), exec.indexOf('async function executeTrade'))
assert.ok(submitBody.includes('setConfirming(true)') && !submitBody.includes('fetch('), 'submitting the form only opens the confirmation')
assert.ok(exec.includes('Atomic') && exec.includes('disabled={saving || confirming}'), 'confirmation keeps the atomic warning and blocks a second submit')
assert.equal(count(exec, 'disabled={confirming}'), 5, 'the five form fields are locked while the confirmation is open')
assert.ok(exec.includes("' หุ้น ราคา $' + form.price") && exec.includes('form.trade_date'), 'the confirmation shows what will be saved')
assert.ok(exec.includes('onExecuted(message)') && !exec.includes('alert('), 'success is reported to the page, not a native alert')

// ---------- trade plan list ----------
const plans = read('components/portfolio/TradePlanWorkspace.tsx')
assert.equal(count(plans, 'void deletePlan(target)'), 1, 'deletePlan runs only from the confirm button')
assert.equal(count(plans, 'deletePlan('), 2, 'deletePlan has one declaration and one call site (any other call would skip the confirmation)')
assert.ok(plans.includes('setDeleteTarget(item)') && !plans.includes('void deletePlan(item)'), 'the delete button only opens the confirmation')
assert.ok(plans.includes('role="status"') && plans.includes('setNotice(message)'), 'execution result shows in the page')

// ---------- ledger ----------
const ledger = read('components/portfolio/TransactionLedger.tsx')
assert.ok(ledger.includes("kind: 'edit'") && ledger.includes("kind: 'delete'"), 'ledger edit and delete both ask first')
assert.ok(!ledger.includes('onClick={() => startEdit(item)}') && !ledger.includes('onClick={() => void remove(item)}'), 'row buttons never edit or delete directly')
assert.equal(count(ledger, 'startEdit(action.item)'), 1, 'startEdit runs from the confirm button only')
assert.equal(count(ledger, 'startEdit('), 2, 'startEdit has one declaration and one call site (any other call would skip the confirmation)')
assert.equal((ledger.match(/\bremove\(/g) ?? []).length, 2, 'remove has one declaration and one call site (any other call would skip the confirmation)')
assert.ok(ledger.includes("setPending({ kind: 'edit', item })") && ledger.includes("setPending({ kind: 'delete', item })"), 'both row buttons only open the confirmation')
assert.equal(count(ledger, 'void remove(action.item)'), 1, 'remove runs from the confirm button only')
assert.ok(ledger.includes('ไม่ Sync จำนวนหุ้นใน Holdings อัตโนมัติ'), 'edit confirmation keeps the no-Holdings-sync warning')

// ---------- manual trade entry ----------
const auto = read('components/portfolio/AutoTradeEntry.tsx')
assert.ok(auto.includes('setSuccessMessage(') && auto.includes('data-testid="auto-trade-success"'), 'success appears in the page')
assert.equal(count(auto, 'window.location.reload()'), 1, 'the page reloads only from the refresh button')
assert.ok(auto.indexOf('window.location.reload()') > auto.indexOf('data-testid="auto-trade-success"'), 'reload is the refresh button, not part of submit')

// ---------- notes drawer ----------
const notes = read('components/navigation/QuickNotesDrawer.tsx')
assert.ok(notes.includes('setConfirmClear(true)') && notes.includes('confirmClearNotes'), 'clearing non-empty notes asks first')
assert.equal(count(notes, "session.edit('')"), 2, 'notes are cleared only for empty content or after confirmation')
assert.ok(notes.includes('setConfirmClear(false)') && notes.indexOf('setConfirmClear(false)') < notes.indexOf('dialog.close()'), 'a pending clear confirmation is dropped when the drawer closes')

// ---------- portfolio switcher ----------
const switcher = read('components/navigation/PortfolioSwitcher.tsx')
assert.ok(switcher.includes('data-testid="portfolio-create-form"') && switcher.includes('autoFocus'), 'new portfolio name is typed in the page')
assert.ok(switcher.includes("event.key === 'Escape'") && switcher.includes('addButtonRef.current?.focus()'), 'Escape closes the form and returns focus')
assert.equal(count(switcher, 'void createPortfolio()'), 1, 'createPortfolio runs from the form submit only')
assert.ok(switcher.includes('maxLength={40}'), 'name length matches the API limit of 40')

console.log('Inline confirmation regression passed: no native dialogs outside the TradingJournal navigation guards')
