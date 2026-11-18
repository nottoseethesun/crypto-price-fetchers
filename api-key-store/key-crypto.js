/**
 * Encrypts an api key with a password, and decrypts it again, as LP Ranger
 * encrypts the api keys it keeps.
 * @module api-key-store/key-crypto
 *
 * What: `encryptKey` turns an api key and a password into an entry that
 * holds the key encrypted, and `decryptKey` gives the key back from the
 * entry and the same password. Without the password, the entry tells
 * nothing of the key.
 *
 * How, as LP Ranger's `src/lib/key-store.js` and `src/lib/api-key-store.js`
 * do it:
 *
 * - The password is made into a 256-bit encryption key by PBKDF2-SHA512 at
 *   600,000 rounds, with a random 16-byte salt, so a password cannot be
 *   guessed quickly from the entry.
 * - The api key is encrypted with that key by AES-256-GCM, with a random
 *   12-byte IV. GCM's 16-byte auth tag makes a wrong password, or an entry
 *   changed on disk, fail to decrypt, rather than give a wrong key.
 * - A new salt and IV are drawn for every encryption, so the same key and
 *   password never give the same entry twice.
 *
 * The entry is LP Ranger's: `{ version: 1, kdfParams: { digest, iterations,
 * saltHex }, ivHex, authTagHex, ciphertextHex }`, so each reads an entry
 * the other wrote. An entry that names another version, digest or number
 * of rounds is refused with a message saying so, rather than read as one
 * the password does not open.
 *
 * Fit: `key-file.js` keeps the entries in a file.
 */

import crypto from 'node:crypto';

/** The entry format's version. */
export const ENTRY_VERSION = 1;

/** PBKDF2 rounds: OWASP's figure for SHA-512, which LP Ranger uses. */
export const PBKDF2_ITERATIONS = 600_000;

/** PBKDF2's digest. */
const PBKDF2_DIGEST = 'sha512';

/** The length of each part, in bytes. */
const BYTES = Object.freeze({ salt: 16, key: 32, iv: 12, authTag: 16 });

/** The cipher. */
const CIPHER = 'aes-256-gcm';

/**
 * Makes an encryption key from a password and a salt.
 *
 * @param {string} password - The password
 * @param {Buffer} salt - The salt
 * @returns {Promise<Buffer>} The 32-byte key
 */
function deriveKey(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, PBKDF2_ITERATIONS, BYTES.key, PBKDF2_DIGEST, (error, key) =>
      error ? reject(error) : resolve(key)
    );
  });
}

/**
 * Checks that a value is a string that is not empty.
 *
 * @param {*} value - The value
 * @param {string} what - What it is, for the message
 * @returns {void}
 * @throws {TypeError} When it is not
 */
function requireText(value, what) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${what} must be a string that is not empty`);
}

/**
 * Reads one hex part of an entry.
 *
 * @param {*} value - The part, as hex
 * @param {?number} bytes - Its length in bytes, or null for any length above zero
 * @param {string} name - The part's name, for the message
 * @returns {Buffer} The part
 * @throws {Error} When it is not hex of that length
 */
function hexPart(value, bytes, name) {
  const fits = typeof value === 'string' && /^(?:[0-9a-f]{2})+$/i.test(value);
  if (!fits || (bytes !== null && value.length !== bytes * 2)) {
    throw new Error(`The saved key's ${name} is not ${bytes === null ? 'hex' : `${bytes} bytes of hex`}`);
  }
  return Buffer.from(value, 'hex');
}

/**
 * Says whether a value is an object, and not null or an array.
 *
 * @param {*} value - The value
 * @returns {boolean} Whether it is
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Reads an entry's parts, checking its shape.
 *
 * @param {*} entry - The entry
 * @returns {{salt: Buffer, iv: Buffer, authTag: Buffer, ciphertext: Buffer}} Its parts
 * @throws {Error} When it is not an entry this reads
 */
function readEntry(entry) {
  const params = isPlainObject(entry) ? entry.kdfParams : undefined;
  const fits =
    isPlainObject(params) &&
    entry.version === ENTRY_VERSION &&
    params.digest === PBKDF2_DIGEST &&
    params.iterations === PBKDF2_ITERATIONS;
  if (!fits) {
    throw new Error(
      `The saved key is not in the format this reads: version ${ENTRY_VERSION}, PBKDF2-SHA512 at ${PBKDF2_ITERATIONS} rounds`
    );
  }
  return {
    salt: hexPart(params.saltHex, BYTES.salt, 'salt'),
    iv: hexPart(entry.ivHex, BYTES.iv, 'IV'),
    authTag: hexPart(entry.authTagHex, BYTES.authTag, 'auth tag'),
    ciphertext: hexPart(entry.ciphertextHex, null, 'ciphertext')
  };
}

/**
 * Encrypts an api key with a password.
 *
 * @param {string} apiKey - The api key
 * @param {string} password - The password
 * @returns {Promise<{version: number, kdfParams: {digest: string, iterations: number, saltHex: string}, ivHex: string, authTagHex: string, ciphertextHex: string}>} The entry
 * @throws {TypeError} When either is not a string that is not empty
 */
export async function encryptKey(apiKey, password) {
  requireText(apiKey, 'The api key');
  requireText(password, 'The password');
  const salt = crypto.randomBytes(BYTES.salt);
  const key = await deriveKey(password, salt);
  const iv = crypto.randomBytes(BYTES.iv);
  const cipher = crypto.createCipheriv(CIPHER, key, iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  return {
    version: ENTRY_VERSION,
    kdfParams: { digest: PBKDF2_DIGEST, iterations: PBKDF2_ITERATIONS, saltHex: salt.toString('hex') },
    ivHex: iv.toString('hex'),
    authTagHex: cipher.getAuthTag().toString('hex'),
    ciphertextHex: ciphertext.toString('hex')
  };
}

/**
 * Decrypts an api key with the password it was encrypted with.
 *
 * @param {Object} entry - The entry (`encryptKey`, or LP Ranger's)
 * @param {string} password - The password
 * @returns {Promise<string>} The api key
 * @throws {Error} When the entry is not one this reads, or the password does not open it
 */
export async function decryptKey(entry, password) {
  requireText(password, 'The password');
  const parts = readEntry(entry);
  const key = await deriveKey(password, parts.salt);
  const decipher = crypto.createDecipheriv(CIPHER, key, parts.iv);
  decipher.setAuthTag(parts.authTag);
  try {
    return Buffer.concat([decipher.update(parts.ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('The password does not open the saved key, or the key was changed on disk');
  }
}
