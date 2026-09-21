import { FileAssetResponse } from '../api/generated'
import { formatFileSize, formatVariantName } from './format'
import type { FileAsset } from './types'

interface OutputFilesProps {
  asset: FileAsset | null
}

export function OutputFiles({ asset }: OutputFilesProps) {
  if (asset?.status !== FileAssetResponse.status.READY || asset.variants.length === 0) {
    return null
  }

  return (
    <section className="outputs" aria-label="Output files">
      {asset.variants.map((variant) => (
        <a href={variant.url} key={variant.variantType} target="_blank" rel="noreferrer">
          {variant.contentType.startsWith('image/') ? (
            <img src={variant.url} alt={variant.variantType.toLowerCase()} />
          ) : (
            <span className="document-output">{variant.variantType}</span>
          )}
          <span>{formatVariantName(variant.variantType)}</span>
          <small>{variant.width && variant.height ? `${variant.width} × ${variant.height}` : variant.contentType} · {formatFileSize(variant.byteSize)}</small>
        </a>
      ))}
    </section>
  )
}
