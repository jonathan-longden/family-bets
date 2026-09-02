/**
 * Password storage. scrypt from node's own crypto: memory-hard, no native
 * dependency to install on a PC, and the parameters are recorded per row so
 * they can be raised later without invalidating anybody's password.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8)
    throw new Error('A password must be at least 8 characters.');
  if (password.length > 200) throw new Error('That password is too long.');
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, PARAMS.keylen, PARAMS);
  return {
    hash: key.toString('hex'),
    salt: `${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('hex')}`,
    algo: 'scrypt'
  };
}

export async function verifyPassword(password, stored) {
  if (!stored || !stored.hash || !stored.salt) return false;
  const [N, r, p, saltHex] = String(stored.salt).split('$');
  if (!saltHex) return false;
  let key;
  try {
    key = await scryptAsync(String(password), Buffer.from(saltHex, 'hex'), PARAMS.keylen, {
      N: Number(N), r: Number(r), p: Number(p)
    });
  } catch { return false; }
  const expected = Buffer.from(stored.hash, 'hex');
  if (expected.length !== key.length) return false;
  return timingSafeEqual(key, expected);
}
