-- ============================================================
-- Migration: scratchpad_notes (Quick Notes / Scratchpad Drawer)
-- รันไฟล์นี้ต่อจาก schema.sql + migration_daily_analyses.sql เดิม (ผ่าน Supabase SQL Editor)
-- เก็บโน้ตส่วนตัว 1 user = 1 แถว (ใช้จดไอเดีย/ฟีเจอร์ที่อยากทำเพิ่มบน Dashboard)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.scratchpad_notes (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.scratchpad_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scratchpad_notes_select_own" ON public.scratchpad_notes;
CREATE POLICY "scratchpad_notes_select_own"
  ON public.scratchpad_notes FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "scratchpad_notes_insert_own" ON public.scratchpad_notes;
CREATE POLICY "scratchpad_notes_insert_own"
  ON public.scratchpad_notes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "scratchpad_notes_update_own" ON public.scratchpad_notes;
CREATE POLICY "scratchpad_notes_update_own"
  ON public.scratchpad_notes FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ใช้ trigger function update_updated_at() ตัวเดียวกับที่ตาราง holdings ใช้อยู่แล้ว (สร้างไว้ใน schema.sql เดิม)
DROP TRIGGER IF EXISTS scratchpad_notes_updated_at ON public.scratchpad_notes;
CREATE TRIGGER scratchpad_notes_updated_at
  BEFORE UPDATE ON public.scratchpad_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

NOTIFY pgrst, 'reload schema';
