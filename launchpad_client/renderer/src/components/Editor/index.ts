export { IntegratedScriptEditor, ScriptEditorModal } from './IntegratedScriptEditor'
export type { IntegratedScriptEditorProps, ScriptEditorModalProps, ScriptEditorEnvironment } from './IntegratedScriptEditor'

export { ScriptEditorSearchPanel } from './ScriptEditorSearchPanel'
export type { ScriptEditorSearchPanelProps, ProjectSearchHit, EditorShell } from './ScriptEditorSearchPanel'

export { ScriptEditorTabs } from './ScriptEditorTabs'
export type { ScriptEditorTabsProps, OpenFileTab } from './ScriptEditorTabs'

export { ScriptEditorGoTo } from './ScriptEditorGoTo'
export type { ScriptEditorGoToProps, SymbolEntry } from './ScriptEditorGoTo'

export {
  FileTree,
  fileBasename,
  parentDirRel,
  ancestorDirRelPathsForFile,
  firstFileRelDepthFirst,
  isPaaRel,
  isP3dRel,
  FileIcon,
  FolderIcon,
  FileTreeContextMenu,
  FileTreeToolbar,
  FileTreePreview,
  useFileTreeDragDrop,
  useFileTreePreview,
  useFileTreeSelection,
  flattenTreeFiles,
} from './FileTree'
export type {
  FileTreeProps,
  ProjectTreeNode,
  FileIconProps,
  FolderIconProps,
  ContextMenuAction,
  ContextMenuTarget,
  FileTreeToolbarProps,
  PreviewData,
  DragState,
  SelectionState,
} from './FileTree'
