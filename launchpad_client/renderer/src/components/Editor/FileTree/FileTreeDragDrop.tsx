import { useCallback, useRef, useState } from 'react'

export type DragState = {
  draggingRel: string | null
  draggingKind: 'file' | 'dir' | null
  dropTargetRel: string | null
  dropPosition: 'inside' | 'before' | 'after' | null
}

export type DragDropHandlers = {
  onDragStart: (rel: string, kind: 'file' | 'dir', e: React.DragEvent) => void
  onDragOver: (rel: string, kind: 'file' | 'dir', e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
}

export type UseFileTreeDragDropProps = {
  onMove: (sourceRel: string, targetDirRel: string) => void | Promise<void>
  disabled?: boolean
}

export type UseFileTreeDragDropResult = {
  dragState: DragState
  handlers: DragDropHandlers
  isDragging: boolean
  getDropIndicatorClass: (rel: string) => string
}

export function useFileTreeDragDrop({
  onMove,
  disabled,
}: UseFileTreeDragDropProps): UseFileTreeDragDropResult {
  const [dragState, setDragState] = useState<DragState>({
    draggingRel: null,
    draggingKind: null,
    dropTargetRel: null,
    dropPosition: null,
  })

  const dragCounterRef = useRef(0)

  const onDragStart = useCallback(
    (rel: string, kind: 'file' | 'dir', e: React.DragEvent) => {
      if (disabled) {
        e.preventDefault()
        return
      }
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', rel)
      setDragState({
        draggingRel: rel,
        draggingKind: kind,
        dropTargetRel: null,
        dropPosition: null,
      })
    },
    [disabled],
  )

  const onDragOver = useCallback(
    (rel: string, kind: 'file' | 'dir', e: React.DragEvent) => {
      if (disabled || !dragState.draggingRel) return

      e.preventDefault()
      e.stopPropagation()

      if (rel === dragState.draggingRel) {
        e.dataTransfer.dropEffect = 'none'
        return
      }

      if (dragState.draggingRel && rel.startsWith(dragState.draggingRel + '/')) {
        e.dataTransfer.dropEffect = 'none'
        return
      }

      e.dataTransfer.dropEffect = 'move'

      let position: 'inside' | 'before' | 'after' = 'inside'
      
      if (kind === 'dir') {
        position = 'inside'
      } else {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const y = e.clientY - rect.top
        const height = rect.height
        if (y < height * 0.3) {
          position = 'before'
        } else if (y > height * 0.7) {
          position = 'after'
        } else {
          position = 'inside'
        }
      }

      setDragState((prev) => ({
        ...prev,
        dropTargetRel: rel,
        dropPosition: kind === 'dir' ? 'inside' : position,
      }))
    },
    [disabled, dragState.draggingRel],
  )

  const onDragLeave = useCallback((_e: React.DragEvent) => {
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setDragState((prev) => ({
        ...prev,
        dropTargetRel: null,
        dropPosition: null,
      }))
    }
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const { draggingRel, dropTargetRel, dropPosition } = dragState

      if (!draggingRel || !dropTargetRel || disabled) {
        setDragState({
          draggingRel: null,
          draggingKind: null,
          dropTargetRel: null,
          dropPosition: null,
        })
        return
      }

      if (draggingRel === dropTargetRel) {
        setDragState({
          draggingRel: null,
          draggingKind: null,
          dropTargetRel: null,
          dropPosition: null,
        })
        return
      }

      let targetDir = dropTargetRel
      if (dropPosition !== 'inside') {
        const parts = dropTargetRel.split('/')
        parts.pop()
        targetDir = parts.join('/') || ''
      }

      void onMove(draggingRel, targetDir)

      setDragState({
        draggingRel: null,
        draggingKind: null,
        dropTargetRel: null,
        dropPosition: null,
      })
    },
    [dragState, disabled, onMove],
  )

  const onDragEnd = useCallback(() => {
    dragCounterRef.current = 0
    setDragState({
      draggingRel: null,
      draggingKind: null,
      dropTargetRel: null,
      dropPosition: null,
    })
  }, [])

  const getDropIndicatorClass = useCallback(
    (rel: string): string => {
      if (dragState.dropTargetRel !== rel) return ''
      if (dragState.dropPosition === 'inside') {
        return [
          "[&_button.file-tree-row]:bg-[color-mix(in_srgb,var(--accent)_15%,transparent)]",
          "[&_button.file-tree-row]:outline [&_button.file-tree-row]:-outline-offset-2 [&_button.file-tree-row]:outline-2 [&_button.file-tree-row]:outline-dashed [&_button.file-tree-row]:outline-[var(--accent)]",
        ].join(" ")
      }
      if (dragState.dropPosition === 'before') {
        return "before:content-[''] before:mx-2 before:mb-0.5 before:block before:h-0.5 before:rounded-sm before:bg-accent"
      }
      if (dragState.dropPosition === 'after') {
        return "after:content-[''] after:mx-2 after:mt-0.5 after:block after:h-0.5 after:rounded-sm after:bg-accent"
      }
      return ""
    },
    [dragState.dropTargetRel, dragState.dropPosition],
  )

  return {
    dragState,
    handlers: {
      onDragStart,
      onDragOver,
      onDragLeave,
      onDrop,
      onDragEnd,
    },
    isDragging: dragState.draggingRel !== null,
    getDropIndicatorClass,
  }
}
