/**
 * File/Folder Input [File context/text path hybrid]
 *
 * This component is a hybrid of a file input and a text input. It allows the user to select a file or folder, or to
 * enter a text path, with backend validation to ensure the path is valid on input, which incorporated IPC.
 *
 */

import { faFile, faFolderOpen } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, useRef, useState } from 'react';
import { getElectronIpc } from '../electronIpc';

type FileFolder = 'file' | 'folder';

type Props = {
  value: string;
  type: FileFolder;
  onChange: (value: string) => void;
};

export function FileFolderInput({ value, type, onChange }: Props) {
  const [path, setPath] = useState(value);
  const ipc = getElectronIpc();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    setPath(value);
  }, [value]);

  useEffect(() => {
    if (!ipc) return;
    void (async () => {
      const res = (await ipc.invoke('file-or-directory-exists', { path })) as { exists: boolean };
      if (res.exists) {
        onChangeRef.current(path);
      }
    })();
  }, [path, ipc]);

  const pickFromExplorer = () => {
    if (!ipc) return;
    void (async () => {
      const res = (await ipc.invoke('show-open-dialog', {
        mode: type === 'folder' ? 'folder' : 'file',
        defaultPath: path.trim() || undefined,
      })) as { canceled: boolean; path: string | null };
      if (!res.canceled && res.path) {
        setPath(res.path);
      }
    })();
  };

  const browseLabel = type === 'folder' ? 'Choose folder' : 'Choose file';
  const browseIcon = type === 'folder' ? faFolderOpen : faFile;

  return (
    <div className="file-folder-input">
      <input
        className="file-folder-input__field"
        type="text"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        spellCheck={false}
        disabled={!ipc}
      />
      <button
        type="button"
        className="btn btn-ghost file-folder-input__browse"
        onClick={pickFromExplorer}
        title={browseLabel}
        aria-label={browseLabel}
        disabled={!ipc}
      >
        <FontAwesomeIcon icon={browseIcon} />
      </button>
    </div>
  );
}
