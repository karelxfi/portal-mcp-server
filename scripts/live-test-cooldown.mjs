const cooldownMs = 30_000

console.log(`Pausing ${cooldownMs / 1000}s before the latency gate so the release suite does not overload SQD Portal.`)
await new Promise((resolve) => setTimeout(resolve, cooldownMs))
