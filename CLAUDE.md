# stock-portfolio — กฎถาวร (Claude Code)

ขัดกันให้กฎส่วนกลาง (`~/.claude/CLAUDE.md`, `settings.json`) ชนะ `AGENTS.md`: สรุป 3 ส่วน, ถามก่อน `git push`, ลอง 2 แนวทางไม่สำเร็จให้หยุดรายงาน. `AGENTS.md` ใช้กับ Codex ด้วย อ่านเฉพาะตอนทำ release/deploy.

## ขอบเขต
- ทำเฉพาะ repo `nine41745-sketch/stock-portfolio` ห้ามแตะ Nine Life Hub, Jane Life Hub หรือระบบอื่น
- ก่อนเริ่มตรวจ `origin/main` และ PR head; อย่าเดา Production จากโค้ด
- ใช้ branch เฉพาะงานจาก main ล่าสุด ห้าม push เข้า main; ฟีเจอร์ใหม่เสนอแผนก่อน

## ต้องอนุมัติแยกทุกครั้ง (ระบุเป้าหมายชัด)
merge, deploy/promote, alias/โดเมน, migration/schema/data, Production DB, ตั้งค่า Supabase/Vercel/GitHub, env vars/secrets, tag/release, ลบ/ยกเลิก deployment, force-push. อนุมัติข้อหนึ่งไม่ครอบคลุมข้ออื่น. ห้ามขอรหัสผ่าน/โทเค็นในแชท. `vercel.json` ต้องคง `deploymentEnabled.main` เป็น false.

## Security
- ห้ามอ่าน/เปิดเผย/คัดลอก Production secrets; ห้ามต่อ Production DB เพื่อทดสอบพัฒนา; ห้ามเรียก Cron endpoint แม้ในเครื่อง
- คง Auth/PIN, การแยกผู้ใช้/พอร์ต, RLS, บัญชีแบบ atomic, SELL_ALL แบบ deterministic; ห้ามลด gate/assertion เพื่อให้ CI ผ่าน
- ห้ามคัดลอกข้อมูลการเงินส่วนตัวลง repo/PR/เอกสาร
- QA บน Preview อ่านอย่างเดียว: ไม่เทรด ไม่แก้ PIN ไม่เรียก `/api/analyze`

## Validation
Node 22.x + `package-lock.json`; ตรวจ `package.json` และ `ci.yml` ก่อนใช้คำสั่ง
```bash
npm ci
npm audit --omit=dev --audit-level=high
npm run ci   # lint + typecheck + build (build รัน test:critical)
```
รายงาน SHA และผ่าน/ไม่ผ่าน/ข้าม/ไม่ได้รัน. CI ผ่านไม่พิสูจน์ RLS จริงหรือพฤติกรรมหลังล็อกอิน. Hobby: ทุก push สร้าง Preview; ห้ามข้าม CI.

## เวอร์ชันและ PR
- งานย่อย 2–3 งานที่ไม่มี SQL รวมเป็นรุ่น/PR เดียวได้; มี SQL หรือบั๊กสำคัญแยก PR เดี่ยว
- แต่ละรุ่นอัปเดตเวอร์ชัน (`package.json`, lockfile, ป้ายในแอป, changelog); PR เอกสาร/คอนฟิกเอเจนต์ล้วนที่ผ่านมาไม่ bump
- PR ชื่อ `docs:` แตะได้เฉพาะ `docs/` กับ `AGENTS.md` (ห้ามแก้/ลบบรรทัดเดิม ถ้าไม่ได้อนุมัติ)
- PR แก้ CI/ruleset/security gate ต้องมีผู้ตรวจอิสระที่ head SHA ปัจจุบัน

## Release/Deploy
อ่าน `AGENTS.md` เฉพาะ "Effective release workflow" (อนุมัติ 1 = merge+Stage, 2 = Promote ระบุ ID/SHA/โดเมน), "Elevated-risk changes", "Production Release Reporting" (+ อัปเดต `docs/RELEASE_STATUS.md`).
ห้าม Stage/Promote ในชั่วโมง cron ของ `vercel.json` (Hobby รันได้ทุกนาทีในชั่วโมงนั้น): 01 UTC อังคาร–เสาร์ (เคยรันจริง ~02 UTC จึงเว้น 01–02), 12 และ 13 UTC จันทร์–ศุกร์.
