import React from 'react'
import { LucideIcon } from 'lucide-react'

interface IconProps {
  icon: LucideIcon
  size?: number
  className?: string
}

export function Icon({ icon: LIcon, size = 16, className = '' }: IconProps) {
  return <LIcon size={size} className={className} />
}
