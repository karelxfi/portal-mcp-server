const cooldownMs = 30_000

console.log(`Pausing ${cooldownMs / 1000}s between heavy live suites so one gate does not overload the next.`)
await new Promise((resolve) => setTimeout(resolve, cooldownMs))
