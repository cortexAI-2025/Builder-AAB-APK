'use client';

type Status = 'idle' | 'triggering' | 'queued' | 'in_progress' | 'success' | 'failure' | 'cancelled';

interface Props {
  status:      Status;
  progress:    number;
  currentStep: string;
  runUrl:      string;
  runId:       number | null;
}

const STATUS_META: Record<Status, { label: string; color: string; bg: string; border: string; dot: string }> = {
  idle:        { label: 'Idle',        color: 'text-gray-400',  bg: 'bg-gray-500/10',   border: 'border-gray-500/20', dot: 'bg-gray-500' },
  triggering:  { label: 'Triggering…', color: 'text-blue-400',  bg: 'bg-blue-500/10',   border: 'border-blue-500/20', dot: 'bg-blue-400 animate-pulse' },
  queued:      { label: 'Queued',      color: 'text-blue-400',  bg: 'bg-blue-500/10',   border: 'border-blue-500/20', dot: 'bg-blue-400 animate-pulse' },
  in_progress: { label: 'Building…',  color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20', dot: 'bg-yellow-400 animate-pulse-slow' },
  success:     { label: 'Success',     color: 'text-green-400',  bg: 'bg-green-500/10',  border: 'border-green-500/20', dot: 'bg-green-400' },
  failure:     { label: 'Failed',      color: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20',   dot: 'bg-red-500' },
  cancelled:   { label: 'Cancelled',   color: 'text-gray-400',  bg: 'bg-gray-500/10',   border: 'border-gray-500/20', dot: 'bg-gray-500' },
};

type ActiveStatus = Exclude<Status, 'idle'>;
const STEPS: { key: ActiveStatus[]; label: string }[] = [
  { key: ['queued', 'in_progress', 'success', 'failure'],           label: 'Queued' },
  { key: ['in_progress', 'success', 'failure'],                     label: 'Building' },
  { key: ['success'],                                               label: 'Success' },
];

export default function ProgressTracker({ status, progress, currentStep, runUrl, runId }: Props) {
  const meta = STATUS_META[status];
  const isActive = status === 'queued' || status === 'in_progress' || status === 'triggering';

  return (
    <div className="space-y-4">
      {/* Status badge */}
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide border ${meta.bg} ${meta.border} ${meta.color}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
        {meta.label}
      </div>

      {/* Progress bar */}
      {status !== 'idle' && (
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-xs text-gray-400">{currentStep || (isActive ? 'Working…' : '')}</span>
            <span className="text-xs text-gray-500 font-mono">{progress}%</span>
          </div>
          <div className="h-2 bg-base rounded-full overflow-hidden border border-border relative">
            <div
              className={`h-full rounded-full transition-all duration-700 relative overflow-hidden ${
                status === 'success'   ? 'bg-green-500' :
                status === 'failure'   ? 'bg-red-500'   :
                status === 'cancelled' ? 'bg-gray-500'  :
                'bg-accent'
              } ${isActive && progress < 100 ? 'progress-indeterminate' : ''}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Step indicators */}
      {status !== 'idle' && (
        <div className="flex items-center gap-0">
          {STEPS.map(({ key, label }, i) => {
            const s    = status as string;
            const done = (key as string[]).includes(s) && s !== 'queued' || (label === 'Queued');
            const active  = (label === 'Queued' && status === 'queued') ||
                            (label === 'Building' && status === 'in_progress');
            const failed  = label === 'Building' && status === 'failure';
            return (
              <div key={label} className="flex items-center">
                <div className={`flex items-center gap-1.5 text-xs font-medium ${
                  failed  ? 'text-red-400' :
                  active  ? 'text-yellow-400' :
                  done    ? 'text-green-400' :
                            'text-gray-600'
                }`}>
                  <span className={`w-4 h-4 rounded-full border flex items-center justify-center text-[10px] ${
                    failed  ? 'border-red-500 bg-red-500/10' :
                    active  ? 'border-yellow-400 bg-yellow-400/10 animate-pulse' :
                    done    ? 'border-green-500 bg-green-500/10' :
                              'border-gray-600'
                  }`}>
                    {failed ? '✕' : done ? '✓' : active ? '●' : ''}
                  </span>
                  {label}
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`w-8 h-px mx-2 ${done && !active ? 'bg-green-500/30' : 'bg-border'}`} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Run link */}
      {runId && runUrl && (
        <a
          href={runUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-accent2 transition-colors"
        >
          View run #{runId} on GitHub →
        </a>
      )}
    </div>
  );
}
