// lib/server/password.ts — §3. Passwords are bcrypt hashes. Full stop.
//
// v1 stored `sellers.pass` in plain text and compared it in SQL
// (`WHERE email=? AND pass=?`). That is gone. There is no code path anywhere
// in this project that stores or compares a plain-text password.

import bcrypt from 'bcryptjs';

/** Work factor. 12 is ~250ms on a modern server — deliberately slow. */
const ROUNDS = 12;

/** Lengths beyond bcrypt's 72-byte input limit are rejected rather than
 *  silently truncated (which would make two different long passwords equal). */
const MAX_PASSWORD_BYTES = 72;
const MIN_PASSWORD_LENGTH = 8;

export interface PasswordPolicyResult {
  valid: boolean;
  problems: string[];
}

export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  const problems: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) {
    problems.push(`Must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    problems.push('Too long — please use 72 bytes or fewer.');
  }
  if (!/[a-zA-Z]/.test(password)) problems.push('Must contain at least one letter.');
  if (!/[0-9]/.test(password)) problems.push('Must contain at least one number.');

  const common = [
    'password', '12345678', 'qwerty123', 'password1', 'admin123',
    'letmein1', 'welcome1', 'agrimall', 'demo1234', 'abc12345',
  ];
  if (common.includes(password.toLowerCase())) {
    problems.push('That password is too common — please choose another.');
  }
  return { valid: problems.length === 0, problems };
}

export async function hashPassword(password: string): Promise<string> {
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new Error('password exceeds bcrypt input limit');
  }
  return bcrypt.hash(password, ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash) {
    // Still burn the time, so a missing-user path and a wrong-password path
    // take the same wall-clock time (no user enumeration by timing).
    await bcrypt.compare(password, DUMMY_HASH);
    return false;
  }
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

/** A real bcrypt hash of a random value, used only to equalise timing. */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.O1234567890abcdefghijklmnopqrstu';

/** True when a stored hash should be re-hashed at next successful login. */
export function needsRehash(hash: string): boolean {
  const m = /^\$2[aby]\$(\d{2})\$/.exec(hash);
  if (!m) return true;
  return parseInt(m[1], 10) < ROUNDS;
}
