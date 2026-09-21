import type { FileAsset, UploadEvent, UploadPhase } from './types'
import { formatElapsedMilliseconds, formatTimeWithMilliseconds } from './format'

interface UploadStatusProps {
  asset: FileAsset | null
  events: UploadEvent[]
  phase: UploadPhase
  progress: number
  error: string | null
}

const phases: Array<{ id: Exclude<UploadPhase, 'idle' | 'failed'>; label: string }> = [
  { id: 'creating', label: 'Created' },
  { id: 'uploading', label: 'Uploading' },
  { id: 'preparing', label: 'Preparing' },
  { id: 'ready', label: 'Ready' },
]

export function UploadStatus({ asset, events, phase, progress, error }: UploadStatusProps) {
  const activeIndex = phases.findIndex((item) => item.id === phase)

  return (
    <section className="upload-detail" aria-live="polite">
      <div>
        <div className="timeline" aria-label="Upload progress">
          {phases.map((item, index) => (
            <TimelineStep
              key={item.id}
              label={item.label}
              number={index + 1}
              complete={activeIndex > index || phase === 'ready'}
              active={item.id === phase}
            />
          ))}
        </div>
        <Progress phase={phase} progress={progress} />
      </div>
      <Activity asset={asset} events={events} error={error} />
    </section>
  )
}

interface TimelineStepProps {
  label: string
  number: number
  complete: boolean
  active: boolean
}

function TimelineStep({ label, number, complete, active }: TimelineStepProps) {
  return (
    <div className={`timeline-step ${complete ? 'complete' : ''} ${active ? 'active' : ''}`}>
      <span>{complete ? '✓' : number}</span>
      <p>{label}</p>
    </div>
  )
}

function Progress({ phase, progress }: Pick<UploadStatusProps, 'phase' | 'progress'>) {
  const percent = Math.round(progress * 100)
  return (
    <div className="progress-row">
      <div className="progress-track" aria-label="Upload bytes" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div style={{ width: `${percent}%` }} />
      </div>
      <span>{phase === 'uploading' ? `${percent}%` : phase === 'ready' ? 'Ready' : ''}</span>
    </div>
  )
}

function Activity({ asset, events, error }: Pick<UploadStatusProps, 'asset' | 'events' | 'error'>) {
  const start = findEvent(events, 'Creating session')
  const sessionCreated = findEvent(events, 'Session created')
  const uploadStarted = events.find((entry) => entry.message.startsWith('Uploading'))
  const uploadVerified = findEvent(events, 'Upload verified')
  const preparationQueued = findEvent(events, 'Preparation queued')
  const ready = findEvent(events, 'Ready')

  return (
    <aside className="activity">
      {asset && <p className="asset-id">{asset.assetId}</p>}
      {start && <p className="activity-start">Started <time dateTime={start.at.toISOString()}>{formatTimeWithMilliseconds(start.at)}</time></p>}
      <ActivityStep label="Session" start={start} end={sessionCreated} />
      <ActivityStep label="Upload" start={uploadStarted} end={uploadVerified} />
      <ActivityStep label="Finalize" start={uploadVerified} end={preparationQueued} />
      <ActivityStep label="Preparation" start={preparationQueued} end={ready} />
      {error && <p className="error" role="alert">{error}</p>}
    </aside>
  )
}

function ActivityStep({ label, start, end }: { label: string; start?: UploadEvent; end?: UploadEvent }) {
  if (!start) {
    return null
  }

  return (
    <p className="activity-step">
      <span>{label}</span>
      <strong>{end ? formatElapsedMilliseconds(end.at.getTime() - start.at.getTime()) : 'In progress'}</strong>
    </p>
  )
}

function findEvent(events: UploadEvent[], message: string): UploadEvent | undefined {
  return events.find((entry) => entry.message === message)
}
