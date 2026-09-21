import { useEffect, useState, useRef } from 'react'
import type { DragEvent } from 'react'
import { formatFileSize } from './format'
import type { UploadPhase } from './types'

interface UploadPickerProps {
  file: File | null
  isRunning: boolean
  phase: UploadPhase
  onFile: (file: File) => void
}

export function UploadPicker({ file, isRunning, phase, onFile }: UploadPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const chooseFile = () => inputRef.current?.click()
  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    const nextFile = event.dataTransfer.files[0]
    if (nextFile) {
      onFile(nextFile)
    }
  }

  return (
    <section
      className={`upload-area ${file ? 'has-file' : 'empty'}`}
      aria-label="Upload file"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        className="file-input"
        type="file"
        onChange={(event) => {
          const nextFile = event.target.files?.[0]
          event.target.value = ''
          if (nextFile) {
            onFile(nextFile)
          }
        }}
      />
      {file ? <SelectedFile file={file} isRunning={isRunning} phase={phase} onReplace={chooseFile} /> : (
        <button className="choose-file" type="button" onClick={chooseFile}>Choose file</button>
      )}
    </section>
  )
}

interface SelectedFileProps {
  file: File
  isRunning: boolean
  phase: UploadPhase
  onReplace: () => void
}

function SelectedFile({ file, isRunning, phase, onReplace }: SelectedFileProps) {
  const previewUrl = useImageUrl(file)

  return (
    <div className="selected-file">
      {previewUrl ? (
        <a className="file-preview" href={previewUrl} target="_blank" rel="noreferrer" aria-label="Open original image">
          <img src={previewUrl} alt={file.name} />
        </a>
      ) : (
        <div className="file-mark">{file.name.slice(0, 1).toUpperCase()}</div>
      )}
      <div className="file-summary">
        <div>
          <p className="file-name">{file.name}</p>
          <dl className="file-data">
            <div><dt>Type</dt><dd>{file.type || 'file'}</dd></div>
            <div><dt>Size</dt><dd>{formatFileSize(file.size)}</dd></div>
            <div><dt>Status</dt><dd>{formatPhase(phase)}</dd></div>
          </dl>
        </div>
        <button className="secondary-action" type="button" disabled={isRunning} onClick={onReplace}>Replace</button>
      </div>
    </div>
  )
}

function useImageUrl(file: File): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!file.type.startsWith('image/')) {
      setUrl(null)
      return undefined
    }
    const nextUrl = URL.createObjectURL(file)
    setUrl(nextUrl)
    return () => URL.revokeObjectURL(nextUrl)
  }, [file])

  return url
}

function formatPhase(phase: UploadPhase): string {
  return phase === 'idle' ? 'Selected' : phase.charAt(0).toUpperCase() + phase.slice(1)
}
