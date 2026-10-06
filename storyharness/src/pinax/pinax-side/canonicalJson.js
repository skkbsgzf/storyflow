function canonicalValue(value, seen) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON only supports finite numbers')
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) return value.map(item => canonicalValue(item, seen))
  if (typeof value !== 'object' || value === undefined) throw new TypeError('Value is not JSON serializable')
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError('Canonical JSON only supports plain objects')
  if (seen.has(value)) throw new TypeError('Canonical JSON does not support cycles')
  seen.add(value)
  const output = {}
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) throw new TypeError('Canonical JSON does not support undefined')
    output[key] = canonicalValue(value[key], seen)
  }
  seen.delete(value)
  return output
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value, new Set()))
}

// Small synchronous SHA-256 implementation keeps the shared contract usable in browsers and Node.
export function sha256Hex(input) {
  const bytes = new TextEncoder().encode(String(input))
  const words = []
  const bitLength = bytes.length * 8
  for (const byte of bytes) words.push(byte)
  words.push(0x80)
  while ((words.length % 64) !== 56) words.push(0)
  const high = Math.floor(bitLength / 0x100000000)
  const low = bitLength >>> 0
  for (let shift = 24; shift >= 0; shift -= 8) words.push((high >>> shift) & 0xff)
  for (let shift = 24; shift >= 0; shift -= 8) words.push((low >>> shift) & 0xff)

  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]
  const rotr = (n, x) => (x >>> n) | (x << (32 - n))
  for (let offset = 0; offset < words.length; offset += 64) {
    const w = new Array(64)
    for (let i = 0; i < 16; i++) {
      const p = offset + i * 4
      w[i] = ((words[p] << 24) | (words[p + 1] << 16) | (words[p + 2] << 8) | words[p + 3]) >>> 0
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]
      const y = w[i - 2]
      const s0 = rotr(7, x) ^ rotr(18, x) ^ (x >>> 3)
      const s1 = rotr(17, y) ^ rotr(19, y) ^ (y >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, hh] = h
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + s1 + ch + k[i] + w[i]) >>> 0
      const s0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (s0 + maj) >>> 0
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    const state = [a, b, c, d, e, f, g, hh]
    for (let i = 0; i < 8; i++) h[i] = (h[i] + state[i]) >>> 0
  }
  return h.map(word => word.toString(16).padStart(8, '0')).join('')
}

export function fingerprintJson(value) {
  return `sha256:${sha256Hex(canonicalJson(value))}`
}

export function withFingerprint(value) {
  const unsigned = { ...value }
  delete unsigned.fingerprint
  return Object.freeze({ ...unsigned, fingerprint: fingerprintJson(unsigned) })
}
