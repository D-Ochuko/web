import type { ComponentPropsWithoutRef } from 'react'

type FieldMessageProps = ComponentPropsWithoutRef<'p'> & {
  kind: 'error' | 'warning'
}

/**
 * Inline form error or warning that does not rely on colour alone (#539):
 * a visible icon carries the meaning, and the role makes assistive tech
 * announce it (`alert` for errors, `status` for warnings).
 */
export default function FieldMessage({
  kind,
  className = '',
  children,
  ...rest
}: FieldMessageProps) {
  const isError = kind === 'error'
  return (
    <p
      role={isError ? 'alert' : 'status'}
      className={`text-xs ${isError ? 'text-red-400' : 'text-amber-400'} ${className}`.trim()}
      {...rest}
    >
      <span aria-hidden="true" className="mr-1 font-bold">
        {isError ? '✕' : '⚠'}
      </span>
      {children}
    </p>
  )
}
