-- ============================================================
-- Migration: PIN Security (Portfolio PIN Lock — ชั้นป้องกันที่ 2 หลัง Gmail/Supabase Auth)
-- รันไฟล์นี้ต่อจาก schema.sql + migration อื่นๆ ที่รันไปแล้ว (ผ่าน Supabase SQL Editor)
-- ห้ามรัน production จนกว่าจะ review — สร้าง migration ใหม่เฉพาะ feature นี้เท่านั้น
-- ไม่แก้ไข schema.sql หรือ migration เก่าไฟล์ใดๆ เลย
-- ============================================================

-- ============================================================
-- TABLE: user_pin_security
-- เก็บ hash/salt ของ PIN 6 หลัก (ไม่ใช่ PIN จริง) + lockout state ต่อ user
-- แยกออกจาก user_settings โดยตั้งใจ — เป็นข้อมูล security-sensitive ระดับสูงกว่า cash balance มาก
-- pin_hash คำนวณจาก scrypt(pin + PIN_PEPPER, pin_salt) ทำใน Node.js (lib/pin.ts) ไม่ใช่ pgcrypto ใน DB
-- เพราะ scrypt เป็น memory-hard function ที่เหมาะกับป้องกัน brute-force ของ PIN สั้นๆ (entropy ต่ำ
-- แค่ 6 หลัก = 1,000,000 ความเป็นไปได้) มากกว่า SHA-256 ตรงๆ ซึ่งเร็วเกินไปจนโดน brute force ได้ง่าย
-- แม้ DB หลุดออกไป — pin_salt กันการทำ rainbow table ข้าม user, PIN_PEPPER (secret แยกใน environment
-- ไม่ได้เก็บใน DB เลย) กันกรณี DB หลุดอย่างเดียวโดยไม่มี environment ก็ยัง brute force ไม่ได้
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_pin_security (
  user_id         UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  pin_hash        TEXT        NOT NULL,
  pin_salt        TEXT        NOT NULL,
  failed_attempts INT         NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- RLS: เปิดไว้แต่ "ไม่มี policy ให้ authenticated/anon เลยแม้แต่ policy เดียว" = deny-by-default
-- ต่างจาก user_settings ที่ user เป็นเจ้าของและอ่าน/แก้ผ่าน client SDK ได้ตรงๆ — ตาราง PIN นี้ต้องเข้าถึง
-- ได้ทางเดียวคือผ่าน service_role (bypass RLS โดย default) ภายใน app/api/pin/* เท่านั้น ซึ่งทุก route
-- ตรวจ supabase.auth.getUser() ยืนยันตัวตนก่อนแตะตารางนี้เสมอในโค้ด server ไม่ได้พึ่ง RLS policy ในการ
-- แยกสิทธิ์ระหว่าง user (เพราะไม่มี policy ให้เข้าถึงเลยไม่ว่ากรณีใด) — ป้องกัน client เรียก
-- supabase.from('user_pin_security').select() ตรงๆ แล้วเห็น pin_hash/pin_salt/failed_attempts ของ
-- ตัวเองได้แม้จะเป็นแถวของตัวเองก็ตาม (ตามที่กำชับห้าม expose ผ่าน normal user SELECT API)
ALTER TABLE public.user_pin_security ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER user_pin_security_updated_at
  BEFORE UPDATE ON public.user_pin_security
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- ============================================================
-- FUNCTION: record_pin_attempt
-- อัปเดต failed_attempts/locked_until แบบ atomic ใน SQL เดียว (UPDATE...RETURNING) กัน race condition
-- เวลามีหลาย verify request พร้อมกัน (เช่น double-click ปุ่ม submit หรือ retry script) — ถ้าทำ
-- read-then-write ใน JS (SELECT count ก่อน แล้วค่อย UPDATE count+1 แยก request) จะเกิด lost update ได้
-- (สอง request อ่าน count เดิมพร้อมกัน ต่างก็เขียน count+1 ทับกัน ทำให้จริงๆ ควรเป็น +2 แต่ได้แค่ +1)
-- ฟังก์ชันนี้ให้ Postgres ทำ increment ในประโยค UPDATE เดียว (ป้องกันด้วย row-level lock ของ Postgres
-- เองอัตโนมัติ ไม่ต้องเขียน lock เพิ่มเอง) แล้ว RETURN ค่าล่าสุดหลังอัปเดตกลับไปให้ route ใช้ตัดสินใจ
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_pin_attempt(p_user_id UUID, p_success BOOLEAN)
RETURNS TABLE (failed_attempts INT, locked_until TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_prev_failed        INT;
  v_prev_locked_until  TIMESTAMPTZ;
  v_effective_failed   INT;
  v_new_failed         INT;
  v_new_locked         TIMESTAMPTZ;
BEGIN
  -- v1.10.10 hotfix (lockout counter bug): เดิมโค้ดบวก failed_attempts ต่อจากค่าเก่าตรงๆ เสมอเมื่อ
  -- p_success = false โดยไม่เคยเช็คว่า lockout รอบก่อนหมดอายุไปแล้วหรือยัง — ทำให้เคส "ผิดครบ 5 ครั้ง
  -- lock 5 นาที, รอครบ 5 นาที, ใส่ผิดอีกแค่ครั้งเดียว" กลายเป็น failed_attempts = 5+1 = 6 (ยัง >= 5)
  -- เลย lock ซ้ำทันทีอีก 5 นาทีทั้งที่ควรเริ่มนับรอบใหม่จาก 1 ครั้ง (พบจาก edge review)
  --
  -- SELECT ... FOR UPDATE ล็อกแถวนี้ไว้ก่อนอ่านค่า ให้ทั้งฟังก์ชันยังคง atomic เหมือนเดิม (กัน race
  -- condition จากหลาย verify request พร้อมกัน) แม้จะแยกเป็นหลายคำสั่งแล้วก็ตาม — request ที่สองที่เรียก
  -- ฟังก์ชันนี้พร้อมกันสำหรับ user เดียวกันจะรอจน request แรกจบ transaction ก่อนเสมอ
  SELECT s.failed_attempts, s.locked_until
  INTO v_prev_failed, v_prev_locked_until
  FROM public.user_pin_security s
  WHERE s.user_id = p_user_id
  FOR UPDATE;

  IF p_success THEN
    UPDATE public.user_pin_security AS s
    SET failed_attempts = 0,
        locked_until    = NULL
    WHERE s.user_id = p_user_id;
  ELSE
    -- ถ้า lockout รอบก่อนมีอยู่และหมดอายุไปแล้ว (locked_until <= NOW()) ให้ถือว่านับรอบใหม่ เริ่มจาก 0
    -- ก่อนบวก ไม่งั้นค่าที่ค้างจากรอบก่อน (5) จะถูกบวกต่อทันที
    v_effective_failed := CASE
      WHEN v_prev_locked_until IS NOT NULL AND v_prev_locked_until <= NOW() THEN 0
      ELSE COALESCE(v_prev_failed, 0)
    END;
    v_new_failed := v_effective_failed + 1;
    v_new_locked := CASE WHEN v_new_failed >= 5 THEN NOW() + INTERVAL '5 minutes' ELSE NULL END;

    UPDATE public.user_pin_security AS s
    SET failed_attempts = v_new_failed,
        locked_until    = v_new_locked
    WHERE s.user_id = p_user_id;
  END IF;

  RETURN QUERY
  SELECT s.failed_attempts, s.locked_until
  FROM public.user_pin_security s
  WHERE s.user_id = p_user_id;
END;
$$;

-- เหมือน RPC อื่นทั้งหมดในโปรเจกต์ (upsert_holding, get_decrypted_holdings) — จำกัดเฉพาะ service_role
-- เรียกได้เท่านั้น กัน client เรียก RPC นี้ตรงๆ ผ่าน DevTools ปลอม p_user_id เป็นคนอื่นแล้ว reset/บวก
-- failed_attempts ของคนอื่นเล่นได้
REVOKE ALL ON FUNCTION public.record_pin_attempt(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_pin_attempt(UUID, BOOLEAN) TO service_role;

NOTIFY pgrst, 'reload schema';
