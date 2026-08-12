// Authenticated encryption for backup files.
//
// AES-256-GCM with a PBKDF2-SHA-256 derived key. GCM is authenticated, so a
// corrupted or tampered file fails to decrypt rather than yielding garbage
// that looks like history.
//
// File layout, all binary, no base64 (the payload is already compressed):
//
//   magic    8  "HISTBAK1"
//   kdf      1  1 = PBKDF2-SHA256
//   cipher   1  1 = AES-256-GCM
//   iters    4  uint32 big-endian
//   salt    16
//   iv      12
//   payload  n  ciphertext with the 16-byte GCM tag appended
//
// The header is authenticated as GCM additional data, so the iteration count
// and algorithm bytes cannot be altered without detection. That matters: a
// stripped-down `iters` would otherwise make a brute force cheaper while still
// producing a file that decrypts.

export const MAGIC = new Uint8Array([0x48, 0x49, 0x53, 0x54, 0x42, 0x41, 0x4b, 0x31]); // HISTBAK1
export const HEADER_BYTES = 8 + 1 + 1 + 4 + 16 + 12; // 42
export const KDF_PBKDF2_SHA256 = 1;
export const CIPHER_AES_256_GCM = 1;

// OWASP's 2023 floor for PBKDF2-HMAC-SHA256. Stored in the file so old backups
// keep opening after this default is raised.
export const DEFAULT_ITERATIONS = 600_000;

const subtle = () => {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("WebCrypto unavailable");
  return c.subtle;
};

export const isEncrypted = bytes => {
  if (!bytes || bytes.length < HEADER_BYTES) return false;
  return MAGIC.every((b, i) => bytes[i] === b);
};

async function deriveKey(passphrase, salt, iterations) {
  if (typeof passphrase !== "string" || passphrase.length === 0) {
    throw new Error("passphrase required");
  }
  const material = await subtle().importKey(
    "raw",
    new TextEncoder().encode(passphrase.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return subtle().deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function buildHeader(iterations, salt, iv) {
  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC, 0);
  header[8] = KDF_PBKDF2_SHA256;
  header[9] = CIPHER_AES_256_GCM;
  new DataView(header.buffer).setUint32(10, iterations, false);
  header.set(salt, 14);
  header.set(iv, 30);
  return header;
}

export function parseHeader(bytes) {
  if (!isEncrypted(bytes)) throw new Error("not a histbak encrypted file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kdf = bytes[8];
  const cipher = bytes[9];
  if (kdf !== KDF_PBKDF2_SHA256) throw new Error(`unsupported KDF: ${kdf}`);
  if (cipher !== CIPHER_AES_256_GCM) throw new Error(`unsupported cipher: ${cipher}`);
  const iterations = view.getUint32(10, false);
  if (iterations < 1 || iterations > 50_000_000) {
    throw new Error(`implausible iteration count: ${iterations}`);
  }
  return {
    kdf,
    cipher,
    iterations,
    salt: bytes.slice(14, 30),
    iv: bytes.slice(30, 42),
    header: bytes.slice(0, HEADER_BYTES),
    payload: bytes.slice(HEADER_BYTES)
  };
}

export async function encrypt(plaintext, passphrase, { iterations = DEFAULT_ITERATIONS } = {}) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const header = buildHeader(iterations, salt, iv);
  const key = await deriveKey(passphrase, salt, iterations);

  const ct = new Uint8Array(
    await subtle().encrypt({ name: "AES-GCM", iv, additionalData: header }, key, plaintext)
  );

  const out = new Uint8Array(header.length + ct.length);
  out.set(header, 0);
  out.set(ct, header.length);
  return out;
}

export async function decrypt(bytes, passphrase) {
  const { iterations, salt, iv, header, payload } = parseHeader(bytes);
  const key = await deriveKey(passphrase, salt, iterations);
  try {
    return new Uint8Array(
      await subtle().decrypt({ name: "AES-GCM", iv, additionalData: header }, key, payload)
    );
  } catch {
    // GCM gives no way to tell a wrong passphrase from a damaged file, and
    // guessing in the message would be misleading.
    throw new Error("decryption failed: wrong passphrase, or the file is damaged");
  }
}

// Rough guidance for the options UI. Not a substitute for a real strength meter,
// but enough to stop someone protecting years of history with "1234".
export function passphraseWarning(pass) {
  if (!pass) return "No passphrase set. Backups will be written unencrypted.";
  if (pass.length < 8) return "Very short. Under 8 characters is trivially brute-forced.";
  if (pass.length < 12 && !/[^a-z]/i.test(pass)) return "Short and all letters. Add length.";
  if (/^\d+$/.test(pass)) return "Digits only. A passphrase of words resists guessing far better.";
  return null;
}
