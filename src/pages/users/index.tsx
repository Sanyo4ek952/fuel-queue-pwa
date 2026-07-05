import { UsersManagementPanel } from '@/features/manage-users'

export function UsersPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Сотрудники</h1>
        <p className="mt-1 text-sm text-slate-500">
          Заявки на регистрацию, действующие сотрудники и история отключений.
        </p>
      </div>
      <UsersManagementPanel />
    </div>
  )
}
