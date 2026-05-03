import { useState, useRef, useEffect, cloneElement, isValidElement, type ReactElement } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  label: string
  hint?: string
  children: ReactElement
  disabled?: boolean
}

export function SidebarTooltip({ label, hint, children, disabled }: Props) {
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLElement>(null)
  const timeoutRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  const show = () => {
    if (disabled) return
    timeoutRef.current = window.setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect()
        setPosition({
          top: rect.top + rect.height / 2,
          left: rect.right + 10,
        })
        setVisible(true)
      }
    }, 300)
  }

  const hide = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setVisible(false)
  }

  const childProps = isValidElement(children) ? (children.props as { onMouseEnter?: (e: React.MouseEvent) => void; onMouseLeave?: (e: React.MouseEvent) => void }) : null
  const child = isValidElement(children)
    ? cloneElement(children, {
        ref: triggerRef,
        onMouseEnter: (e: React.MouseEvent) => {
          show()
          childProps?.onMouseEnter?.(e)
        },
        onMouseLeave: (e: React.MouseEvent) => {
          hide()
          childProps?.onMouseLeave?.(e)
        },
      } as Record<string, unknown>)
    : children

  return (
    <>
      {child}
      {visible && createPortal(
        <div
          className="pointer-events-none fixed z-[9999]"
          style={{ 
            top: `${position.top}px`, 
            left: `${position.left}px`,
            transform: 'translateY(-50%)',
          }}
          role="tooltip"
        >
          <div 
            className="rounded-md border border-border bg-surface px-2.5 py-1.5 shadow-md dark:border-border-strong"
            style={{ animation: 'tooltip-fade-in 0.15s ease-out' }}
          >
            <div className="whitespace-nowrap text-[12px] font-semibold text-heading">
              {label}
            </div>
            {hint && (
              <div className="mt-0.5 whitespace-nowrap text-[11px] text-muted">
                {hint}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
