import { useCallback, useEffect, useState } from 'react'
import { OutputFiles } from './ui/OutputFiles'
import { UploadPicker } from './ui/UploadPicker'
import { UploadStatus } from './ui/UploadStatus'
import type { FileAsset, UploadEvent, UploadPhase } from './ui/types'
import { uploadFile } from './upload'

export function App() {
  const [file, setFile] = useState<File | null>(null)
  const [asset, setAsset] = useState<FileAsset | null>(null)
  const [connection, setConnection] = useState<'checking' | 'online' | 'offline'>('checking')
  const [events, setEvents] = useState<UploadEvent[]>([])
  const [phase, setPhase] = useState<UploadPhase>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8080/api'
    let active = true
    const checkConnection = async () => {
      try {
        const response = await fetch(`${apiUrl}/actuator/health`)
        if (active) {
          setConnection(response.ok ? 'online' : 'offline')
        }
      } catch {
        if (active) {
          setConnection('offline')
        }
      }
    }

    void checkConnection()
    const interval = window.setInterval(checkConnection, 5_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

  const startUpload = useCallback((nextFile: File) => {
    setFile(nextFile)
    setAsset(null)
    setEvents([])
    setError(null)
    setProgress(0)
    void uploadFile({
      file: nextFile,
      onAsset: setAsset,
      onEvent: (message) => setEvents((current) => [...current, { at: new Date(), message }]),
      onPhase: setPhase,
      onProgress: setProgress,
    }).catch((reason: unknown) => {
      setPhase('failed')
      setError(reason instanceof Error ? reason.message : 'Upload failed')
    })
  }, [])

  const isRunning = phase === 'creating' || phase === 'uploading' || phase === 'preparing'

  return (
    <main className="workspace">
      <header className="masthead">
        <p className="eyebrow">Uploads</p>
        <span className={`connection connection-${connection}`}>
          <i aria-hidden="true" />
          {connection === 'online' ? 'Local' : connection === 'offline' ? 'Offline' : 'Checking'}
        </span>
      </header>

      <UploadPicker file={file} isRunning={isRunning} phase={phase} onFile={startUpload} />
      {file && <UploadStatus asset={asset} events={events} phase={phase} progress={progress} error={error} />}
      <OutputFiles asset={asset} />
    </main>
  )
}
