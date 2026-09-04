import type { DownloadProgress } from "../../download/Download";

export interface DownloadProgressItem extends DownloadProgress {
  readonly id: string;
  readonly label: string;
}

interface DownloadProgressListProps {
  items: readonly DownloadProgressItem[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function DownloadProgressList({ items }: DownloadProgressListProps) {
  if (!items.length) return <p className="download-processing">Preparing files...</p>;

  return (
    <div className="download-progress-list" aria-live="polite">
      {items.map((item) => {
        const ratio = item.total_bytes && item.total_bytes > 0
          ? Math.min(item.loaded_bytes / item.total_bytes, 1)
          : null;
        return (
          <div className="download-progress-item" key={item.id}>
            <div className="download-progress-label">
              <span>{item.label}</span>
              <span>
                {formatBytes(item.loaded_bytes)}
                {item.total_bytes !== null && ` / ${formatBytes(item.total_bytes)}`}
              </span>
            </div>
            <div
              className={`download-progress-track${ratio === null ? " indeterminate" : ""}`}
              role="progressbar"
              aria-label={item.label}
              aria-valuemin={0}
              aria-valuemax={item.total_bytes ?? undefined}
              aria-valuenow={item.total_bytes === null ? undefined : item.loaded_bytes}
            >
              <span style={ratio === null ? undefined : { width: `${ratio * 100}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
