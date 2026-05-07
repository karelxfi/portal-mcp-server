export type Point = { x: number; y: number; label?: string; raw?: unknown }

/**
 * Largest-Triangle-Three-Buckets downsampling.
 * Preserves visual peaks/troughs much better than stride sampling.
 */
export function lttb(points: Point[], threshold: number): Point[] {
  const len = points.length
  if (threshold >= len || threshold <= 2) return points

  const sampled: Point[] = []
  const every = (len - 2) / (threshold - 2)

  let a = 0
  sampled.push(points[a]!)

  for (let i = 0; i < threshold - 2; i++) {
    const rangeStart = Math.floor((i + 1) * every) + 1
    const rangeEnd = Math.min(Math.floor((i + 2) * every) + 1, len)

    let avgX = 0
    let avgY = 0
    const avgRangeLength = rangeEnd - rangeStart
    for (let j = rangeStart; j < rangeEnd; j++) {
      avgX += points[j]!.x
      avgY += points[j]!.y
    }
    avgX /= avgRangeLength || 1
    avgY /= avgRangeLength || 1

    const rangeOffs = Math.floor(i * every) + 1
    const rangeTo = Math.floor((i + 1) * every) + 1
    const pointA = points[a]!
    const pointAX = pointA.x
    const pointAY = pointA.y

    let maxArea = -1
    let maxAreaPoint = rangeOffs

    for (let j = rangeOffs; j < rangeTo; j++) {
      const p = points[j]!
      const area =
        Math.abs((pointAX - avgX) * (p.y - pointAY) - (pointAX - p.x) * (avgY - pointAY)) * 0.5
      if (area > maxArea) {
        maxArea = area
        maxAreaPoint = j
      }
    }

    sampled.push(points[maxAreaPoint]!)
    a = maxAreaPoint
  }

  sampled.push(points[len - 1]!)
  return sampled
}
