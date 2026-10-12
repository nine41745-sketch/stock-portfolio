import { createServiceClient } from '@/lib/supabase/server'
import { PhaseAError, requirePhaseAPortfolio, phaseAErrorResponse } from '@/lib/phase-a-context'
import { parseDividendRange, summarizeDividends } from '@/lib/dividend-intelligence'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const from = url.searchParams.get('from') ?? `${today.slice(0, 4)}-01-01`
    const to = url.searchParams.get('to') ?? today
    try { parseDividendRange(from, to) } catch (error) { throw new PhaseAError(error instanceof Error ? error.message : 'ช่วงเวลาไม่ถูกต้อง', 400) }
    const { userId, portfolioId, portfolioName } = await requirePhaseAPortfolio(url.searchParams.get('portfolio_id') ?? undefined)
    const service = createServiceClient()
    // One bounded RPC response, not offset pages from independent snapshots.
    // Exact count is mandatory: a Data API row cap must fail closed, not look complete.
    const { data: records, error, count } = await service.rpc('get_decrypted_portfolio_transactions', { p_user_id: userId, p_portfolio_id: portfolioId, p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY! }, { count: 'exact' })
      .eq('transaction_type', 'DIVIDEND').gte('trade_date', from).lte('trade_date', to)
      .order('trade_date', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(0, 10_000)
    if (error || !Array.isArray(records)) throw new PhaseAError('อ่าน Transaction Ledger ไม่สำเร็จ', 503)
    if (!Number.isSafeInteger(count) || count === null || count < 0) throw new PhaseAError('ยืนยันความครบถ้วนของ Ledger ไม่สำเร็จ จึงไม่แสดงยอดรวม', 503)
    if (count > 10_000 || records.length > 10_000) throw new PhaseAError('ช่วงเวลามีรายการมากเกินขอบเขต กรุณาเลือกช่วงสั้นลง', 409)
    if (records.length !== count || new Set(records.map(row => row.id)).size !== count || records.some(row => typeof row.id !== 'string' || !row.id)) {
      throw new PhaseAError('Ledger ที่อ่านได้ไม่ครบหรือมีรายการซ้ำ กรุณาเลือกช่วงสั้นลง; ยังไม่แสดงยอดรวม', 503)
    }
    const rows = records.map(row => ({ id: String(row.id ?? ''), transaction_type: String(row.transaction_type), symbol: row.symbol == null ? null : String(row.symbol).toUpperCase(), amount: row.amount == null ? null : Number(row.amount), trade_date: String(row.trade_date) }))
    return Response.json({ ...summarizeDividends(rows, from, to), portfolio: { id: portfolioId, name: portfolioName }, as_of: new Date().toISOString(), methodology: 'ยอด DIVIDEND ที่บันทึกใน Ledger เท่านั้น ไม่ยืนยันยอดกับ broker และไม่ตีความว่า gross/net; ไม่มี forecast หรือการเพิ่ม DIME' }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return phaseAErrorResponse(error) }
}
