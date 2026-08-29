export type FollowupPlan = {
  callArgs?: Record<string, unknown>
  persistedArgs?: Record<string, unknown>
  error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function shorterDuration(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const match = /(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/i.exec(value)
  if (!match) return undefined
  const amount = Number(match[1])
  const unit = match[2].toLowerCase()
  const multiplier = unit.startsWith('d') ? 86400 : unit.startsWith('h') ? 3600 : unit.startsWith('m') ? 60 : 1
  const seconds = Math.max(60, Math.round((amount * multiplier) / 2))
  if (seconds % 86400 === 0) return `${seconds / 86400}d`
  if (seconds % 3600 === 0) return `${seconds / 3600}h`
  return `${Math.max(1, Math.round(seconds / 60))}m`
}

export function planFollowup(params: {
  intent: string
  currentArgs: Record<string, unknown>
  nextCursor?: unknown
  actionArguments?: unknown
}): FollowupPlan {
  const { cursor: _previousCursor, ...baseArgs } = params.currentArgs
  let callArgs = isRecord(params.actionArguments) ? params.actionArguments : { ...baseArgs }

  if (params.intent === 'continue') {
    if (typeof params.nextCursor !== 'string') return { error: 'This result does not include a valid continuation cursor.' }
    return { callArgs: { cursor: params.nextCursor }, persistedArgs: { ...baseArgs } }
  }
  if (params.intent === 'compare_previous') callArgs = { ...baseArgs, compare_previous: true }
  if (params.intent === 'zoom_in') {
    const duration = shorterDuration(baseArgs.duration)
    if (!duration) return { error: 'This result does not include a duration that can be narrowed safely.' }
    callArgs = { ...baseArgs, duration }
  }
  return { callArgs, persistedArgs: callArgs }
}
