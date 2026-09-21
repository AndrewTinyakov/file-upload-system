export function formatFileSize(size: number): string {
  return size < 1_000_000 ? `${Math.ceil(size / 1_000)} KB` : `${(size / 1_000_000).toFixed(1)} MB`
}

export function formatVariantName(name: string): string {
  return name.toLowerCase().replace('_', ' ')
}

export function formatTimeWithMilliseconds(date: Date): string {
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
  return `${time}.${String(date.getMilliseconds()).padStart(3, '0')}`
}

export function formatElapsedMilliseconds(milliseconds: number): string {
  return `${milliseconds.toLocaleString()} ms`
}
