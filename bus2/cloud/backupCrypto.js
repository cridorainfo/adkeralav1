import crypto from 'crypto';

/**
 * Symmetric encryption for the platform backup file — admin supplies a passphrase at download
 * time (never stored anywhere server-side, never logged), the whole backup is encrypted with it,
 * and the same passphrase is required to restore. Makes the downloaded file safe to keep in
 * email/cloud storage/a USB drive even though its contents (device tokens, password hashes,
 * every ad/route/schedule) are highly sensitive — without the passphrase it's unreadable noise.
 *
 * AES-256-GCM (authenticated — tampering or corruption is detected, not silently accepted) with a
 * per-export random salt/IV and scrypt key derivation (Node's own default cost parameters: secure
 * against offline brute-force without needing custom tuning, and safely under Node's default
 * scrypt memory ceiling so this can't itself become a DoS vector).
 *
 * File layout: 'ABKP' magic (4B) + format version (1B) + salt (16B) + iv (12B) + GCM auth tag
 * (16B) + ciphertext.
 */

const MAGIC = Buffer.from('ABKP');
const FORMAT_VERSION = 1;
const SALT_LEN = 16;
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;
const KEY_LEN = 32; // AES-256

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(String(passphrase ?? ''), salt, KEY_LEN);
}

export function encryptBackup(plaintextJson, passphrase) {
  if (!passphrase || String(passphrase).length < 8) {
    throw new Error('Backup passphrase must be at least 8 characters');
  }
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintextJson, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, Buffer.from([FORMAT_VERSION]), salt, iv, authTag, ciphertext]);
}

export function decryptBackup(fileBuffer, passphrase) {
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length < MAGIC.length + 1 + SALT_LEN + IV_LEN + AUTH_TAG_LEN) {
    throw new Error('Not a valid AdKerala backup file');
  }
  if (!fileBuffer.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Not a valid AdKerala backup file');
  }
  const version = fileBuffer[MAGIC.length];
  if (version !== FORMAT_VERSION) {
    throw new Error(`Unsupported backup format version ${version}`);
  }
  let offset = MAGIC.length + 1;
  const salt = fileBuffer.subarray(offset, offset + SALT_LEN);
  offset += SALT_LEN;
  const iv = fileBuffer.subarray(offset, offset + IV_LEN);
  offset += IV_LEN;
  const authTag = fileBuffer.subarray(offset, offset + AUTH_TAG_LEN);
  offset += AUTH_TAG_LEN;
  const ciphertext = fileBuffer.subarray(offset);

  const key = deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    // GCM auth-tag mismatch throws on wrong key OR corrupted ciphertext — can't distinguish the
    // two from here, so give the honest combined answer rather than a misleading specific one.
    throw new Error('Could not decrypt backup — wrong passphrase, or the file is corrupted');
  }
}
