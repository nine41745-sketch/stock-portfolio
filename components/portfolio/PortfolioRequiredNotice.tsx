export default function PortfolioRequiredNotice() {
  return (
    <section role="status" className="mx-auto w-full max-w-3xl rounded-xl border border-blue-800/60 bg-blue-950/30 p-5 text-blue-100">
      <h1 className="text-lg font-semibold">ยังไม่มีพอร์ตสำหรับบัญชีนี้</h1>
      <p className="mt-2 text-sm leading-relaxed text-blue-100/80">
        หน้านี้เป็นแบบอ่านข้อมูล จึงยังไม่สร้างพอร์ตให้อัตโนมัติ ใช้ปุ่ม “เพิ่มพอร์ต” ในแถบด้านบนเพื่อสร้างพอร์ตแรก แล้วโหลดหน้าอีกครั้ง
      </p>
    </section>
  )
}
