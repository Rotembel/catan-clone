// Seeded, pure RNG (mulberry32). No Date.now(), no Math.random(), no
// internal mutable state — every call takes a state and returns a new one,
// so it can live inside GameState.rngState and keep the engine deterministic
// (CLAUDE.md: "Inject a seeded RNG. Same inputs -> same output.").

/** Opaque, serializable RNG state (a stringified int32). */
export type RngState = string;

function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export function createRng(seed: string | number): RngState {
  return String(hashSeed(String(seed)));
}

/** One mulberry32 step: pure function of the current state. */
function step(state: number): { value: number; nextState: number } {
  const a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, nextState: a };
}

/** A uniform float in [0, 1). */
export function nextFloat(state: RngState): { value: number; state: RngState } {
  const { value, nextState } = step(Number(state) | 0);
  return { value, state: String(nextState) };
}

/** A uniform integer in [0, maxExclusive). */
export function nextInt(state: RngState, maxExclusive: number): { value: number; state: RngState } {
  const { value: f, state: next } = nextFloat(state);
  return { value: Math.floor(f * maxExclusive), state: next };
}

/** A single die, 1-6. */
export function rollDie(state: RngState): { value: number; state: RngState } {
  const { value, state: next } = nextInt(state, 6);
  return { value: value + 1, state: next };
}

/** Two dice, as Catan rolls them. */
export function rollTwoDice(state: RngState): { dice: [number, number]; state: RngState } {
  const a = rollDie(state);
  const b = rollDie(a.state);
  return { dice: [a.value, b.value], state: b.state };
}

/** Fisher-Yates shuffle, pure — returns a new array and the advanced state. */
export function shuffle<T>(items: readonly T[], state: RngState): { result: T[]; state: RngState } {
  const result = [...items];
  let s = state;
  for (let i = result.length - 1; i > 0; i--) {
    const { value: j, state: next } = nextInt(s, i + 1);
    s = next;
    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }
  return { result, state: s };
}
