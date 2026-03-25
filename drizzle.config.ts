import { loadEnvConfig } from '@next/env';
import { defineConfig } from 'drizzle-kit';

loadEnvConfig(process.cwd());

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for Drizzle migrations.');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/postgres/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  strict: true,
  verbose: true,
});
