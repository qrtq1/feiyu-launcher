import type { CSSProperties, ReactNode } from 'react'

type IconName =
  | 'home'
  | 'grid'
  | 'user'
  | 'settings'
  | 'play'
  | 'stop'
  | 'folder'
  | 'download'
  | 'trash'
  | 'plus'
  | 'x'
  | 'minus'
  | 'square'
  | 'chevron'
  | 'search'
  | 'refresh'
  | 'terminal'
  | 'check'
  | 'alert'
  | 'fish'
  | 'box'
  | 'coffee'
  | 'heart'
  | 'globe'
  | 'sparkles'
  | 'pin'
  | 'image'

const PATHS: Record<IconName, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" />,
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6h.09A1.7 1.7 0 0 0 10 3.05V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
    </>
  ),
  play: <path d="M8 5.5v13l11-6.5z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  download: (
    <>
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  x: (
    <>
      <path d="m6 6 12 12" />
      <path d="m18 6-12 12" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  square: <rect x="5.5" y="5.5" width="13" height="13" rx="1.5" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3" />
      <path d="M13 15h4" />
    </>
  ),
  check: <path d="m5 13 4.5 4.5L19 7" />,
  alert: (
    <>
      <path d="M12 3 2.5 20h19z" />
      <path d="M12 9v5" />
      <path d="M12 17.2v.1" />
    </>
  ),
  fish: (
    <>
      <path d="M3 12c3-5 7-7 10-7 4 0 7 3 8 7-1 4-4 7-8 7-3 0-7-2-10-7z" />
      <path d="M8 8c-1-2-2-3-4-3 0 2 .5 4 2 5" />
      <circle cx="16" cy="11" r=".8" fill="currentColor" stroke="none" />
    </>
  ),
  pin: <path d="M12 17v5M9 10V5a1 1 0 0 1 0-2h6a1 1 0 0 1 0 2v5l4 4v2H5v-2z" />,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8" cy="9" r="1.5" /><path d="m4 17 5-5 3.5 3 2.5-2 5 4" /></>,
  box: (
    <>
      <path d="M12 3 3 7.5v9L12 21l9-4.5v-9z" />
      <path d="M3 7.5 12 12l9-4.5" />
      <path d="M12 12v9" />
    </>
  ),
  coffee: (
    <>
      <path d="M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" />
      <path d="M16 9h2a2.5 2.5 0 0 1 0 5h-2" />
      <path d="M7 3v2M10 3v2M13 3v2" />
    </>
  ),
  heart: <path d="M12 20.5s-7.5-4.6-7.5-9.6A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 7.5 3.3c0 5-7.5 9.6-7.5 9.6z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.8 3 4.2 6 4.2 9s-1.4 6-4.2 9c-2.8-3-4.2-6-4.2-9s1.4-6 4.2-9z" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />
      <path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" />
    </>
  )
}

/** 版本号比较：1.2.10 比 1.2.9 大；缺位按 0 算 */
export function cmpMcVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x - y
  }
  return 0
}

/** 下载量：1234 → 1.2K，1234567 → 1.2M */
export function fmtDownloads(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n)
}

export function Icon({ name, size = 18, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  )
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <div className="logo" style={{ width: size, height: size }}>
      <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden>
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="46" height="46" rx="13" fill="url(#lg)" />
        <path
          d="M11 25c4.5-7 10-9.5 14.5-9.5C31.5 15.5 36 20 38 25c-2 5-6.5 9.5-12.5 9.5C20 34.5 15.5 32 11 25z"
          fill="rgba(255,255,255,.92)"
        />
        <path d="M16.5 18.5c-1.5-2.5-3-3.8-5.5-4 .3 3 1.5 5 3.6 6.2z" fill="rgba(255,255,255,.75)" />
        <circle cx="30.5" cy="23" r="1.7" fill="#1e293b" />
      </svg>
    </div>
  )
}

export function ProgressBar({ value, max = 100, indeterminate = false }: { value: number; max?: number; indeterminate?: boolean }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className={`progress ${indeterminate ? 'progress-indeterminate' : ''}`}>
      <div className="progress-fill" style={indeterminate ? { width: '35%' } : { width: '100%', transform: `scaleX(${pct / 100})` }} />
    </div>
  )
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} />
}

export function Tag({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'ok' | 'warn' | 'err' | 'accent' }) {
  return <span className={`tag tag-${tone}`}>{children}</span>
}

export function Empty({ icon = 'box', title, desc, action }: { icon?: IconName; title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={30} />
      </div>
      <div className="empty-title">{title}</div>
      {desc && <div className="empty-desc">{desc}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  )
}

export function Modal({ children, onClose, width = 480 }: { children: ReactNode; onClose: () => void; width?: number }) {
  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }}>
        {children}
      </div>
    </div>
  )
}

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" className={`switch ${checked ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(!checked)} role="switch" aria-checked={checked}>
      <span className="switch-dot" />
    </button>
  )
}
