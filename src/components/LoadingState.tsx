import { Loader2, type LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/Card'

interface LoadingStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  className?: string
}

export function LoadingState({ icon: Icon = Loader2, title, description, className = '' }: LoadingStateProps) {
  return (
    <Card className={`border-arc-border bg-arc-card p-4 ${className}`}>
      <div className="flex items-center gap-3">
        <Icon size={18} className="animate-spin text-arc-gold" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-arc-text">{title}</p>
          {description ? <p className="text-xs text-arc-text-dim">{description}</p> : null}
        </div>
      </div>
    </Card>
  )
}
