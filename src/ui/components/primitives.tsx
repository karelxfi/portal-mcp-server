import type { CSSProperties, ReactNode } from 'react'

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export type TextVariant =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'label'
  | 'body'
  | 'body-semi'
  | 'caption'
  | 'code'
  | 'metric'
  | 'metric-sm'

export function Text({
  children,
  variant = 'body',
  tone,
  as: Tag = 'span',
  style,
  className,
  title,
}: {
  children: ReactNode
  variant?: TextVariant
  tone?: 'muted' | 'subtle' | 'default'
  as?: keyof JSX.IntrinsicElements
  style?: CSSProperties
  className?: string
  title?: string
}) {
  const toneClass = tone === 'muted' ? 'pt-text--muted' : tone === 'subtle' ? 'pt-text--subtle' : ''
  return (
    <Tag
      title={title}
      className={cx('pt-text', `pt-text--${variant}`, toneClass, className)}
      style={style}
    >
      {children}
    </Tag>
  )
}

export function Stack({
  children,
  direction = 'col',
  gap = 0,
  align,
  justify,
  wrap,
  style,
  className,
}: {
  children: ReactNode
  direction?: 'col' | 'row'
  gap?: number
  align?: 'start' | 'center' | 'end' | 'stretch'
  justify?: 'start' | 'center' | 'end' | 'between' | 'around'
  wrap?: boolean
  style?: CSSProperties
  className?: string
}) {
  const alignMap = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' }
  const justifyMap = {
    start: 'flex-start',
    center: 'center',
    end: 'flex-end',
    between: 'space-between',
    around: 'space-around',
  }
  return (
    <div
      className={cx('pt-stack', `pt-stack--${direction}`, className)}
      style={{
        gap: gap ? `${gap}px` : undefined,
        alignItems: align ? alignMap[align] : undefined,
        justifyContent: justify ? justifyMap[justify] : undefined,
        flexWrap: wrap ? 'wrap' : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function Badge({
  children,
  variant = 'default',
}: {
  children: ReactNode
  variant?: 'default' | 'accent' | 'success' | 'danger' | 'warning'
}) {
  return <span className={cx('pt-badge', variant !== 'default' && `pt-badge--${variant}`)}>{children}</span>
}

export function Button({
  children,
  onClick,
  disabled,
  variant = 'default',
  type = 'button',
  title,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'default' | 'primary' | 'ghost'
  type?: 'button' | 'submit'
  title?: string
}) {
  return (
    <button
      type={type}
      className={cx('pt-btn', variant !== 'default' && `pt-btn--${variant}`)}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  )
}

export function Card({
  children,
  title,
  subtitle,
  actions,
  wide,
  span,
  bodyFlush,
  bodyTight,
  className,
}: {
  children: ReactNode
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  wide?: boolean
  span?: 'full' | 'half' | 'third' | 'two-third'
  bodyFlush?: boolean
  bodyTight?: boolean
  className?: string
}) {
  const spanClass =
    wide || span === 'full'
      ? 'pt-panel--wide'
      : span === 'half'
      ? 'pt-panel--half'
      : span === 'third'
      ? 'pt-panel--third'
      : span === 'two-third'
      ? 'pt-panel--two-third'
      : 'pt-panel--half'
  return (
    <article className={cx('pt-card', spanClass, className)}>
      {(title || subtitle || actions) && (
        <header className="pt-card__header">
          <div className="pt-card__header-copy">
            {title && (
              <Text variant="h2" as="h2">
                {title}
              </Text>
            )}
            {subtitle && (
              <Text variant="caption" tone="muted">
                {subtitle}
              </Text>
            )}
          </div>
          {actions && <div className="pt-card__actions">{actions}</div>}
        </header>
      )}
      <div
        className={cx(
          'pt-card__body',
          bodyFlush && 'pt-card__body--flush',
          bodyTight && 'pt-card__body--tight',
        )}
      >
        {children}
      </div>
    </article>
  )
}

export function Skeleton({ width, height = 14 }: { width?: string | number; height?: number }) {
  return (
    <div
      className="pt-skeleton"
      style={{ width: typeof width === 'number' ? `${width}px` : width ?? '100%', height }}
    />
  )
}
