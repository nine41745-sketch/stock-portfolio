export interface FxTradeInput {
  quantity: number
  acquisitionPrice: number
  disposalPrice: number
  acquisitionFee: number
  disposalFee: number
  acquisitionFx: number
  disposalFx: number
  sourceCurrency: string
  reportingCurrency: string
  source: string
  sourceRetrievedAt: string
  acquisitionRateDate: string
  disposalRateDate: string
}

export interface FxAttribution {
  status: 'available' | 'unavailable'
  reason?: string
  sourceCurrency?: string
  reportingCurrency?: string
  rateConvention?: string
  source?: string
  sourceRetrievedAt?: string
  acquisitionRateDate?: string
  disposalRateDate?: string
  securityPnl?: number
  fxPnl?: number
  totalPnl?: number
  reconciliationDelta?: number
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function isValidTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime())
}

function cents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * Uses reporting-currency units per one source-currency unit. Fees are
 * attributed at acquisition FX with the security contribution; disposal FX
 * applies to net disposal proceeds. This makes the two contributions reconcile
 * exactly (within cent rounding) to converted net cash flows.
 */
export function attributeFxProfit(input: FxTradeInput): FxAttribution {
  const sourceCurrency = typeof input.sourceCurrency === 'string' ? input.sourceCurrency.trim().toUpperCase() : ''
  const reportingCurrency = typeof input.reportingCurrency === 'string' ? input.reportingCurrency.trim().toUpperCase() : ''
  const source = typeof input.source === 'string' ? input.source.trim() : ''
  const numeric = [input.quantity, input.acquisitionPrice, input.disposalPrice,
    input.acquisitionFee, input.disposalFee, input.acquisitionFx, input.disposalFx]
  if (!numeric.every(Number.isFinite)
    || input.quantity <= 0
    || input.acquisitionPrice < 0
    || input.disposalPrice < 0
    || input.acquisitionFee < 0
    || input.disposalFee < 0
    || input.acquisitionFx <= 0
    || input.disposalFx <= 0
    || !/^[A-Z]{3}$/.test(sourceCurrency)
    || !/^[A-Z]{3}$/.test(reportingCurrency)
    || sourceCurrency === reportingCurrency
    || !source
    || typeof input.sourceRetrievedAt !== 'string'
    || !isValidTimestamp(input.sourceRetrievedAt)
    || !isValidDate(input.acquisitionRateDate)
    || !isValidDate(input.disposalRateDate)) {
    return { status: 'unavailable', reason: 'ต้องมีข้อมูลธุรกรรม สกุลเงิน แหล่งที่มา และวันที่อัตราแลกเปลี่ยนที่ตรวจสอบได้ครบถ้วน' }
  }

  const acquisitionCash = input.quantity * input.acquisitionPrice + input.acquisitionFee
  const netDisposalCash = input.quantity * input.disposalPrice - input.disposalFee
  const securityPnl = (netDisposalCash - acquisitionCash) * input.acquisitionFx
  const fxPnl = netDisposalCash * (input.disposalFx - input.acquisitionFx)
  const totalPnl = netDisposalCash * input.disposalFx - acquisitionCash * input.acquisitionFx
  const roundedSecurity = cents(securityPnl)
  const roundedFx = cents(fxPnl)
  const roundedTotal = cents(totalPnl)

  return {
    status: 'available',
    sourceCurrency,
    reportingCurrency,
    rateConvention: 'reporting currency units per one source currency unit',
    source,
    sourceRetrievedAt: input.sourceRetrievedAt,
    acquisitionRateDate: input.acquisitionRateDate,
    disposalRateDate: input.disposalRateDate,
    securityPnl: roundedSecurity,
    fxPnl: roundedFx,
    totalPnl: roundedTotal,
    reconciliationDelta: cents(roundedSecurity + roundedFx - roundedTotal),
  }
}
