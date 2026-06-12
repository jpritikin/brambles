// Shared RNG for the Stahl Shrine animation: defaults to Math.random, but can
// be reseeded (e.g. by dump-step.ts --seed=<n>) for reproducible traces of
// otherwise-randomized behavior (step 2's pour order, step 1's grind
// scatter/duration).

// Mulberry32: a small, fast seeded PRNG.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let randFn: () => number = Math.random;

// Reseeds the shared RNG. Must be called before any module that consumes
// `rand()` at load time (e.g. stahl-scene.ts's step 2 pour-order shuffle) is
// imported.
export function setSeed(seed: number): void {
  randFn = mulberry32(seed);
}

export function rand(): number {
  return randFn();
}
