/** Seeded randomness, so every simulation and demo dataset is reproducible. */

export type Rand = () => number

/** Mulberry32: small, fast, good enough for simulation. Returns floats in [0, 1). */
export function mulberry32(seed: number): Rand {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function bernoulli(rand: Rand, p: number): boolean {
  return rand() < p
}

export function randInt(rand: Rand, min: number, maxInclusive: number): number {
  return min + Math.floor(rand() * (maxInclusive - min + 1))
}

export function pick<T>(rand: Rand, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]
}

/** Standard normal via Box-Muller. */
export function normal(rand: Rand): number {
  const u = Math.max(rand(), 1e-12)
  const v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** Lognormal with the given mean and coefficient of variation. */
export function lognormal(rand: Rand, mean: number, cv: number): number {
  const sigma2 = Math.log(1 + cv * cv)
  const mu = Math.log(mean) - sigma2 / 2
  return Math.exp(mu + Math.sqrt(sigma2) * normal(rand))
}

/** Poisson via Knuth for small means, normal approximation above 30. */
export function poisson(rand: Rand, mean: number): number {
  if (mean <= 0) return 0
  if (mean > 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * normal(rand)))
  const limit = Math.exp(-mean)
  let k = 0
  let p = 1
  do {
    k++
    p *= rand()
  } while (p > limit)
  return k - 1
}

/** Weibull draw with the given shape and scale. */
export function weibull(rand: Rand, shape: number, scale: number): number {
  return scale * Math.pow(-Math.log(Math.max(1 - rand(), 1e-12)), 1 / shape)
}
