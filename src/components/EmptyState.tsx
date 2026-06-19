import { type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  className = '',
}: EmptyStateProps) {
  return (
    <Card className={`border-arc-border bg-arc-card p-4 ${className}`}>
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-arc-accent/10 text-arc-accent">
          <Icon size={20} />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-arc-text">{title}</p>
          {description ? <p className="text-xs leading-relaxed text-arc-text-dim">{description}</p> : null}
        </div>
        {actionLabel && onAction ? (
          <Button variant="outline" size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </Card>
  )
}
