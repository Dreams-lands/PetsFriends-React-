const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const DEFAULT_JWT_SECRET = 'petsfriend_qlthucung_secret_2026';

function getJwtSecret() {
  return process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
}

function isBcryptHash(str) {
  return /^\$2[aby]\$/.test(String(str || ''));
}

async function hashPassword(plain) {
  return bcrypt.hash(String(plain), 10);
}

async function verifyPassword(plain, storedHash) {
  if (storedHash === null || storedHash === undefined) {
    return false;
  }
  if (isBcryptHash(storedHash)) {
    return bcrypt.compare(String(plain), storedHash);
  }
  return String(plain) === String(storedHash);
}

function signUserToken(user) {
  const payload = {
    userId: Number(user.userId ?? user.id),
    email: user.email,
    role: user.role,
    username: user.username || null,
  };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' });
}

function verifyUserToken(token) {
  return jwt.verify(token, getJwtSecret());
}

module.exports = {
  isBcryptHash,
  hashPassword,
  verifyPassword,
  signUserToken,
  verifyUserToken,
};
