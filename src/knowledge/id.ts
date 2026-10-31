// Record identifiers: monotonic ULID (FR-029, research.md §5).
//
// 48-bit millisecond timestamp + 80-bit randomness, Crockford base32, 26 characters. Plain string
// sort equals creation order — FR-027a relies on that. The monotonic variant increments the random
// component when two ids share a millisecond (or the clock steps back), so ids from one process
// are strictly increasing. It says nothing about ids minted on different machines: a skewed clock
// can mint a later id that sorts earlier, which is why supersession chains are ordered by the
// `supersedes` graph, never by id (data-model §2.2).

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10;
const RANDOM_LEN = 16;
const MAX_TIME = 2 ** 48 - 1;
const RANDOM_LIMIT = 1n << 80n;

/** A canonical ULID: 26 upper-case Crockford base32 characters, timestamp within 48 bits. */
export const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export function isUlid(value: unknown): value is string {
  return typeof value === "string" && ULID_PATTERN.test(value);
}

/** The millisecond timestamp encoded in a ULID. */
export function ulidTime(id: string): number {
  if (!isUlid(id)) throw new Error(`not a ULID: ${id}`);
  let t = 0;
  for (const c of id.slice(0, TIME_LEN)) t = t * 32 + ALPHABET.indexOf(c);
  return t;
}

function encodeTime(ms: number): string {
  if (!Number.isInteger(ms) || ms < 0 || ms > MAX_TIME) throw new Error(`time out of ULID range: ${ms}`);
  let out = "";
  for (let i = 0; i < TIME_LEN; i++) {
    out = ALPHABET[ms % 32] + out;
    ms = Math.floor(ms / 32);
  }
  return out;
}

function encodeRandom(n: bigint): string {
  let out = "";
  for (let i = 0; i < RANDOM_LEN; i++) {
    out = ALPHABET[Number(n & 31n)] + out;
    n >>= 5n;
  }
  return out;
}

function randomBits(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

export interface UlidSource {
  now?: () => number;
  /** Fills and returns 10 random bytes (80 bits). */
  random?: () => Uint8Array;
}

/** A monotonic ULID generator. Each call returns an id strictly greater than the previous one. */
export function createUlidFactory(source: UlidSource = {}): () => string {
  const now = source.now ?? Date.now;
  const random = source.random ?? (() => crypto.getRandomValues(new Uint8Array(10)));
  let lastTime = -1;
  let lastRandom = 0n;
  return () => {
    const t = now();
    if (t <= lastTime) {
      lastRandom += 1n;
      if (lastRandom >= RANDOM_LIMIT) throw new Error("ULID random component overflowed within one millisecond");
    } else {
      lastTime = t;
      lastRandom = randomBits(random()) & (RANDOM_LIMIT - 1n);
    }
    return encodeTime(lastTime) + encodeRandom(lastRandom);
  };
}

/** The process-wide generator. */
export const newUlid = createUlidFactory();
