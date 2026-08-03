// ============================================================
// Stock Meta — Sector & Business description แบบ "นิ่ง" (Static)
//
// ปัญหาเดิม: AI (Llama-70b) สุ่มเขียนคำอธิบาย sector/business เองทุกครั้งที่วิเคราะห์
// ทำให้ข้อความสลับไปมาไม่คงที่ (วันนี้บอกอย่าง พรุ่งนี้บอกอีกอย่าง)
//
// แก้โดยตัด AI ออกจากหน้าที่นี้ทั้งหมด ใช้ข้อมูลนิ่งแทน เรียงลำดับ:
//   1) Static mapping ของหุ้นในพอร์ต (ภาษาไทย กระชับ ตรงเป้า แม่นยำที่สุด)
//   2) Fallback ไป Yahoo Finance assetProfile module (sector/industry ภาษาอังกฤษ) ถ้าไม่มีใน mapping
//   3) null (UI จะไม่แสดง section นี้ ไม่ error)
//
// เพิ่มหุ้นใหม่เข้าพอร์ต: เพิ่มแถวใน STOCK_META ด้านล่างได้เลย (ไม่บังคับ — ถ้าไม่เพิ่ม
// ระบบจะลอง Yahoo Finance ให้อัตโนมัติ แต่ผลจะเป็นภาษาอังกฤษและอาจไม่กระชับเท่า)
// ============================================================
import YahooFinance from 'yahoo-finance2'
import { cacheGet, cacheSet } from './cache'

const yahooFinance = new YahooFinance()

export interface StockMeta {
  sector: string | null
  business: string | null
}

// Static mapping — ข้อมูลนิ่ง 100% ไม่เปลี่ยนไปมาไม่ว่าจะวิเคราะห์กี่รอบ
const STOCK_META: Record<string, StockMeta> = {
  NVO:  { sector: 'เฮลท์แคร์ (ยา/เวชภัณฑ์)',              business: 'ผู้ผลิตยารักษาเบาหวานและโรคอ้วนรายใหญ่ (Ozempic, Wegovy)' },
  META: { sector: 'เทคโนโลยี (สื่อสังคมออนไลน์)',           business: 'เจ้าของ Facebook, Instagram, WhatsApp เน้นโฆษณาดิจิทัลและ AI' },
  NOW:  { sector: 'เทคโนโลยี (ซอฟต์แวร์องค์กร)',           business: 'ผู้ให้บริการซอฟต์แวร์ Workflow อัตโนมัติสำหรับองค์กร (ServiceNow)' },
  RBRK: { sector: 'เทคโนโลยี (Cybersecurity / Cloud Data)', business: 'ผู้ให้บริการปกป้องและกู้คืนข้อมูลจากภัยไซเบอร์บนคลาวด์ (Rubrik)' },
  TEM:  { sector: 'เฮลท์แคร์ (AI / Precision Medicine)',    business: 'แพลตฟอร์ม AI วิเคราะห์ข้อมูลการแพทย์เพื่อรักษาแบบเฉพาะบุคคล (Tempus AI)' },
  ORCL: { sector: 'เทคโนโลยี (ซอฟต์แวร์ / คลาวด์)',        business: 'ผู้ให้บริการฐานข้อมูลองค์กรและ Cloud Infrastructure (Oracle)' },
  PLTR: { sector: 'เทคโนโลยี (Big Data / AI)',              business: 'แพลตฟอร์มวิเคราะห์ข้อมูลขนาดใหญ่สำหรับภาครัฐและองค์กร (Palantir)' },
  SOFI: { sector: 'การเงิน (Fintech)',                       business: 'ธนาคารดิจิทัลให้บริการกู้ยืม บัตรเครดิต และการลงทุนออนไลน์ (SoFi)' },
  SPCX: { sector: 'อวกาศ / สื่อสารดาวเทียม',                business: 'หุ้นอ้างอิงธุรกิจอวกาศ SpaceX/Starlink ผ่านกองทุนเอกชน' },
}

// sector/industry แทบไม่เปลี่ยนเลย เก็บ cache ไว้นาน 24 ชม. ลดการยิง Yahoo ซ้ำ
const META_CACHE_TTL_SEC = 24 * 60 * 60

async function fetchFromYahoo(symbol: string): Promise<StockMeta | null> {
  try {
    const profile = await yahooFinance.quoteSummary(symbol, { modules: ['assetProfile'] })
    const sector = profile.assetProfile?.sector ?? null
    const industry = profile.assetProfile?.industry ?? null
    if (!sector && !industry) return null
    return { sector, business: industry }
  } catch (e) {
    console.error(`[stock-meta] Yahoo assetProfile error for ${symbol}:`, e)
    return null
  }
}

// ดึง sector/business ของหุ้น — นิ่ง 100% ไม่ใช้ AI สุ่มเขียนอีกต่อไป
export async function getStockMeta(symbol: string): Promise<StockMeta> {
  const upper = symbol.toUpperCase()
  if (STOCK_META[upper]) return STOCK_META[upper]

  const cacheKey = `stock-meta:${upper}`
  const cached = cacheGet<StockMeta>(cacheKey)
  if (cached) return cached

  const fromYahoo = await fetchFromYahoo(upper)
  const result: StockMeta = fromYahoo ?? { sector: null, business: null }
  cacheSet(cacheKey, result, META_CACHE_TTL_SEC)
  return result
}
