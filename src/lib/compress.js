// gzip via the platform's CompressionStream. No library: this ships in Chrome,
// Firefox and Node, and history JSON is highly repetitive so gzip does well on
// it (typically 8-12x).
//
// Order matters. Compression happens BEFORE encryption, always. Ciphertext is
// indistinguishable from random and will not compress, so the reverse order
// would produce a file larger than the input.
//
// The usual caveat about compress-then-encrypt (CRIME/BREACH) needs an attacker
// who can inject chosen plaintext into the compressed stream and watch the
// resulting size. That is a network-oracle attack. Nothing here is served over
// a network, and the file size is already a rough proxy for "how much history",
// which is not a secret worth 10x the disk.

async function pipe(bytes, stream) {
  const src = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(src).arrayBuffer());
}

export const gzip = bytes => pipe(bytes, new CompressionStream("gzip"));
export const gunzip = bytes => pipe(bytes, new DecompressionStream("gzip"));

// gzip magic: 1f 8b, then 08 for the deflate method.
export const isGzip = b => b?.length > 2 && b[0] === 0x1f && b[1] === 0x8b && b[2] === 0x08;

export const encodeJson = value => new TextEncoder().encode(JSON.stringify(value));
export const decodeJson = bytes => JSON.parse(new TextDecoder().decode(bytes));
