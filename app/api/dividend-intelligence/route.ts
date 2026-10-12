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
    // Filter and page the set-returning RPC, never silently summarize a default row-limit slice.
    const records: Array<Record<string, unknown>> = []
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await service.rpc('get_decrypted_portfolio_transactions', { p_user_id: userId, p_portfolio_id: portfolioId, p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY! })
        .eq('transaction_type', 'DIVIDEND').gte('trade_date', from).lte('trade_date', to).range(offset, offset + 499)
      if (error || !Array.isArray(data)) throw new PhaseAError('อ่าน Transaction Ledger ไม่สำเร็จ', 503)
      records.push(...data)
      if (records.length > 10_000) throw new PhaseAError('ช่วงเวลามีรายการมากเกินขอบเขต กรุณาเลือกช่วงสั้นลง', 409)
      if (data.length < 500) break
    }
    const rows = records.map(row => ({ id: String(row.id ?? ''), transaction_type: String(row.transaction_type), symbol: row.symbol == null ? null : String(row.symbol).toUpperCase(), amount: row.amount == null ? null : Number(row.amount), trade_date: String(row.trade_date) }))
    return Response.json({ ...summarizeDividends(rows, from, to), portfolio: { id: portfolioId, name: portfolioName }, as_of: new Date().toISOString(), methodology: 'ยอด DIVIDEND ที่บันทึกใน Ledger เท่านั้น ไม่ยืนยันยอดกับ broker และไม่ตีความว่า gross/net; ไม่มี forecast หรือการเพิ่ม DIME' }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return phaseAErrorResponse(error) }
}
