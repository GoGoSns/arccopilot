import React from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export function Input({ label, error, className = '', ...props }: InputProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-xs font-medium text-arc-text-dim uppercase tracking-wider">
          {label}
        </label>
      )}
      <input
        className={`w-full bg-arc-card border border-arc-border rounded-xl px-3 py-2.5 text-sm text-arc-text placeholder-arc-text-dim focus:outline-none focus:border-arc-gold/60 transition-colors ${error ? 'border-arc-danger' : ''} ${className}`}
        {...props}
      />
      {error && <p className="text-xs text-arc-danger">{error}</p>}
    </div>
  )
}
