import { PublicQueueCheckForm } from '@/features/public-queue-check'

export function PublicQueueCheckPage() {
  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6 text-slate-950 sm:py-10">
      <main className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-md items-center">
        <PublicQueueCheckForm />
      </main>
    </div>
  )
}
