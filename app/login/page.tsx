import LoginForm from '@/components/auth/LoginForm'

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white">📈 Stock Portfolio</h1>
          <p className="mt-2 text-gray-400">พอร์ตหุ้น US ส่วนตัว</p>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
