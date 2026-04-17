'use client';

type BuildType = 'apk' | 'aab' | 'both';

interface Props {
  buildType:          BuildType;
  signRelease:        boolean;
  keystoreConfigured: boolean;
  workflowExists:     boolean | null;
  installingWorkflow: boolean;
  triggering:         boolean;
  canBuild:           boolean;
  onBuildTypeChange:  (t: BuildType) => void;
  onSignChange:       (v: boolean) => void;
  onInstallWorkflow:  () => void;
  onTrigger:          () => void;
  onKeystoreClick:    () => void;
}

const BUILD_TYPES: { value: BuildType; label: string; desc: string; icon: string }[] = [
  { value: 'apk',  label: 'APK',  desc: 'Debug APK — install directly on device', icon: '📱' },
  { value: 'aab',  label: 'AAB',  desc: 'Release bundle — for Play Store upload',  icon: '📦' },
  { value: 'both', label: 'Both', desc: 'Produce APK + AAB in one run',            icon: '⚡' },
];

export default function BuildPanel({
  buildType, signRelease, keystoreConfigured,
  workflowExists, installingWorkflow, triggering, canBuild,
  onBuildTypeChange, onSignChange,
  onInstallWorkflow, onTrigger, onKeystoreClick,
}: Props) {
  return (
    <div className="space-y-5">
      {/* Workflow status */}
      {workflowExists === false && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 flex items-start gap-3">
          <span className="text-yellow-400 mt-0.5 flex-shrink-0">⚠</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-yellow-300 font-medium">Workflow not found</p>
            <p className="text-xs text-yellow-400/70 mt-0.5">
              android-build.yml is not installed in this repo.
            </p>
          </div>
          <button
            onClick={onInstallWorkflow}
            disabled={installingWorkflow}
            className="flex-shrink-0 text-xs bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/30 text-yellow-300 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {installingWorkflow ? 'Installing…' : 'Install'}
          </button>
        </div>
      )}

      {workflowExists === true && (
        <div className="flex items-center gap-2 text-xs text-green-400">
          <span>✓</span> Workflow ready
        </div>
      )}

      {/* Build type selector */}
      <div>
        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
          Output format
        </label>
        <div className="grid grid-cols-3 gap-2">
          {BUILD_TYPES.map(({ value, label, icon }) => (
            <button
              key={value}
              onClick={() => onBuildTypeChange(value)}
              className={`flex flex-col items-center gap-1 py-3 rounded-lg border text-sm font-medium transition-all ${
                buildType === value
                  ? 'bg-accent/10 border-accent/50 text-white'
                  : 'bg-base border-border text-gray-400 hover:border-gray-600'
              }`}
            >
              <span className="text-lg">{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          {BUILD_TYPES.find(t => t.value === buildType)?.desc}
        </p>
      </div>

      {/* Signing */}
      <div className="flex items-center justify-between py-3 px-3 bg-base border border-border rounded-lg">
        <div>
          <p className="text-sm font-medium text-gray-200">Sign release</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {keystoreConfigured ? '🔑 Keystore configured' : 'No keystore — add one first'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onKeystoreClick}
            className="text-xs text-accent2 hover:text-white border border-border hover:border-accent/50 px-2 py-1 rounded transition-all"
          >
            {keystoreConfigured ? 'Update' : 'Add keystore'}
          </button>
          <button
            role="switch"
            aria-checked={signRelease}
            onClick={() => onSignChange(!signRelease)}
            disabled={!keystoreConfigured}
            className={`relative w-10 h-5 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
              signRelease ? 'bg-accent' : 'bg-border'
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${signRelease ? 'translate-x-5' : ''}`} />
          </button>
        </div>
      </div>

      {/* Build button */}
      <button
        onClick={onTrigger}
        disabled={!canBuild || triggering || workflowExists !== true}
        className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg text-sm transition-opacity"
      >
        {triggering ? (
          <>
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin-slow" />
            Triggering…
          </>
        ) : (
          <>▶&nbsp; Launch build</>
        )}
      </button>
    </div>
  );
}
