require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';

if (isProd && !process.env.JWT_SECRET) throw new Error('JWT_SECRET must be set in production');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set');

module.exports = {
  isProd,
  port: process.env.PORT || 3000,
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret',
};
