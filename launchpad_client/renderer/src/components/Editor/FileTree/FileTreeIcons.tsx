import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faFile,
  faFileCode,
  faFileImage,
  faCube,
  faCog,
  faFileLines,
  faFileAudio,
  faFolder,
  faFolderOpen,
  faDatabase,
  faFileArchive,
} from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'

type FileIconType = 
  | 'script'
  | 'image'
  | 'model'
  | 'config'
  | 'description'
  | 'audio'
  | 'archive'
  | 'data'
  | 'generic'

const EXTENSION_MAP: Record<string, FileIconType> = {
  sqf: 'script',
  sqs: 'script',
  fsm: 'script',
  
  paa: 'image',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  tga: 'image',
  
  p3d: 'model',
  rtm: 'model',
  
  cpp: 'config',
  hpp: 'config',
  inc: 'config',
  
  ext: 'description',
  txt: 'description',
  md: 'description',
  
  ogg: 'audio',
  wav: 'audio',
  wss: 'audio',
  
  pbo: 'archive',
  zip: 'archive',
  
  bin: 'data',
  bikb: 'data',
  bisurf: 'data',
  rvmat: 'data',
}

const ICON_MAP: Record<FileIconType, IconDefinition> = {
  script: faFileCode,
  image: faFileImage,
  model: faCube,
  config: faCog,
  description: faFileLines,
  audio: faFileAudio,
  archive: faFileArchive,
  data: faDatabase,
  generic: faFile,
}

const COLOR_MAP: Record<FileIconType, string> = {
  script: 'var(--file-icon-script, #4fc3f7)',
  image: 'var(--file-icon-image, #81c784)',
  model: 'var(--file-icon-model, #ba68c8)',
  config: 'var(--file-icon-config, #ffb74d)',
  description: 'var(--file-icon-description, #90a4ae)',
  audio: 'var(--file-icon-audio, #f06292)',
  archive: 'var(--file-icon-archive, #a1887f)',
  data: 'var(--file-icon-data, #7986cb)',
  generic: 'var(--file-icon-generic, var(--text-muted))',
}

function getFileType(filename: string): FileIconType {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_MAP[ext] ?? 'generic'
}

export type FileIconProps = {
  filename: string
  className?: string
}

export function FileIcon({ filename, className }: FileIconProps) {
  const fileType = getFileType(filename)
  const icon = ICON_MAP[fileType]
  const color = COLOR_MAP[fileType]

  return (
    <span
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center text-xs ${className ?? ""}`}
      style={{ color }}
    >
      <FontAwesomeIcon icon={icon} />
    </span>
  )
}

export type FolderIconProps = {
  isOpen: boolean
  className?: string
}

export function FolderIcon({ isOpen, className }: FolderIconProps) {
  return (
    <span
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center text-xs text-[var(--file-icon-folder)] ${className ?? ""}`}
    >
      <FontAwesomeIcon icon={isOpen ? faFolderOpen : faFolder} />
    </span>
  )
}

export function getFileTypeFromName(filename: string): FileIconType {
  return getFileType(filename)
}
