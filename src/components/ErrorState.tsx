import { AlertCircle, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

interface ErrorStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  className?: string
}

export function ErrorState({
  icon: Icon = AlertCircle,
  title,
  description,
  actionLabel,
  onAction,
  className = '',
}: ErrorStateProps) {
  return (
    <Card className={`border-arc-border bg-arc-card p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 text-arc-text-dim" size={18} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-arc-text">{title}</p>
          {description ? <p className="text-xs leading-relaxed text-arc-text-dim">{description}</p> : null}
        </div>
      </div>
      {actionLabel && onAction ? (
        <Button className="mt-3" variant="outline" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </Card>
  )
}
