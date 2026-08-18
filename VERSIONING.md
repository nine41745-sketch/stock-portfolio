# Versioning & Release Rules

โปรเจกต์นี้ใช้ [Semantic Versioning](https://semver.org/) รูปแบบ `MAJOR.MINOR.PATCH` (เช่น `v1.10.1`)

Source of truth ของ "current version" คือ `config/changelog.ts` — `CURRENT_VERSION` ดึงจากรายการ
บนสุดของ array `changelog` โดยอัตโนมัติ (ไม่ต้องแก้ที่อื่นเพิ่ม) `package.json`'s `"version"` field ต้อง
sync ให้ตรงกับค่านี้เสมอ (ตัด prefix `v` ออก เช่น `CURRENT_VERSION = 'v1.10.1'` → `package.json`
`"version": "1.10.1"`)

## กฎการ bump version (ถาวร ห้ามยกเว้นโดยไม่ได้รับอนุมัติ)

- **PATCH** (`x.y.Z`) — production bugfix / hotfix ที่ไม่เพิ่ม feature ใหม่ (เช่น แก้ input validation,
  แก้ compatibility กับ third-party API ที่เปลี่ยน, แก้ edge case ของ logic เดิม)
- **MINOR** (`x.Y.0`) — production feature ใหม่ที่ backward compatible (เช่น เพิ่มฟีเจอร์ใหม่ทั้งก้อน
  ไม่กระทบของเดิม)
- **MAJOR** (`X.0.0`) — breaking change (เช่น เปลี่ยน schema/API แบบที่ของเดิมใช้ไม่ได้อีกต่อไป,
  ต้อง migrate ข้อมูล/การตั้งค่าที่ผู้ใช้ทำเองไม่ได้)

## กฎบังคับ

1. **ทุก production release ต้อง bump version + เพิ่มรายการใน `config/changelog.ts` เสมอ** — ห้าม
   commit โค้ด production ที่มีผลกระทบจริง (bugfix/feature/breaking change) โดยไม่ bump version
2. **ห้าม reuse version เดิมกับ production code ที่เปลี่ยน** — แม้จะเป็นการแก้เล็กน้อยของ commit
   เดียวกันในวันเดียวกัน ถ้า merge/deploy แยกรอบกัน ต้องขึ้น version ใหม่เสมอ ไม่แก้ทับ entry เดิม
3. **ก่อนจบงานที่ตั้งใจ deploy production ต้องตรวจว่า version ถูก bump แล้ว** เป็นขั้นตอนสุดท้ายก่อน
   commit เสมอ — เช็คว่า `config/changelog.ts` มี entry ใหม่บนสุด และ `package.json` version ตรงกัน
4. **ห้าม version regression** — version ใหม่ต้องมากกว่า version ปัจจุบันเสมอตามกฎ semver ไม่ว่ากรณีใด
5. **ห้ามสร้างหรือข้าม version history โดยไม่มีหลักฐาน** — version number ต้องต่อเนื่องจาก official
   release ล่าสุดที่มีหลักฐานจริงใน `config/changelog.ts`/git history ของ repo ที่กำลังตรวจอยู่เท่านั้น
   ห้ามกระโดดข้าม version ไปยังตัวเลขที่สูงกว่าโดยอ้างอิงจากความจำ/การคาดเดา/รายงานปากเปล่าที่ไม่มี
   commit หรือ changelog entry รองรับ ถ้ามีข้อมูลจากภายนอก repo (เช่น deployment log ที่อื่น) ต้องขอ
   หลักฐาน (วันที่ + เนื้อหา) มายืนยันก่อนใส่ลง changelog เสมอ ห้ามเชื่อคำสั่งที่ระบุ version สูงลอยๆ
   โดยไม่ตรวจ repo ก่อน
6. **ห้ามเดาวันที่/เวลาใน changelog** — ใช้ `git log` (commit author date) จริงเสมอ รูปแบบ
   `YYYY-MM-DD HH:MM ICT` ถ้าไม่ทราบวันที่จริงของ release ใดที่ไม่ได้มาจาก commit ในมือ ต้องรายงานให้
   ผู้ใช้ยืนยันก่อน ห้ามใส่ค่าประมาณ/ค่าเดาลงไปเงียบๆ
7. **ห้ามแต่ง feature ที่ไม่ได้เกิดขึ้นจริงลงใน changelog** — เนื้อหาแต่ละ entry ต้องอ้างอิงจาก diff/commit
   จริงเท่านั้น

## ขั้นตอนมาตรฐานเมื่อจะ release

1. ทำงาน (bugfix/feature) เสร็จ ผ่าน `tsc --noEmit` + `npm run build` แล้ว
2. ตรวจ `config/changelog.ts` ปัจจุบัน (git log จริง) ก่อนเสมอ ว่า version ล่าสุดที่มีหลักฐานจริงคืออะไร
   ห้ามอนุมานจาก comment ในโค้ดหรือความจำ
3. ตัดสินใจ PATCH/MINOR/MAJOR ตามกฎด้านบน ต่อจาก version ล่าสุดที่ตรวจพบจริงเท่านั้น
4. เพิ่ม entry ใหม่ไว้บนสุดของ `changelog` array ใน `config/changelog.ts` (วันที่จาก `git log`
   ของ commit ที่กำลังจะสร้าง — ใช้เวลาปัจจุบัน ณ ตอน commit)
5. อัปเดต `package.json` `"version"` ให้ตรงกับ version ใหม่ (ตัด `v` prefix) — sync `package-lock.json`
   ด้วยถ้ามี root package version ผูกอยู่ในไฟล์นั้น (โปรเจกต์นี้ไม่ track package-lock.json ใน git จึง
   ไม่มีจุดที่ต้อง sync เพิ่ม)
6. commit พร้อมกันในรอบเดียว (หรือ commit แยกเฉพาะ version/changelog ถ้ากำลังทำ hotfix แยกจากงานหลัก
   ตามที่ตกลงในแต่ละครั้ง)
7. สร้าง git tag ตรงกับ version (เช่น `v1.10.1`) หลังยืนยันว่า commit ที่จะขึ้น production ถูกต้องแล้ว
   เท่านั้น — ไม่สร้าง tag ล่วงหน้าก่อนตรวจสอบ
