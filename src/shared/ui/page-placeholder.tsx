import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card'

export function PagePlaceholder({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <Card className="rounded-lg border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-slate-500">
          Экран подготовлен в FSD-структуре и будет наполняться на следующих этапах MVP.
        </p>
      </CardContent>
    </Card>
  )
}
