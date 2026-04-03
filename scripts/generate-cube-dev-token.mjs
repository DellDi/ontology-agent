import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

function toBase64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function parseEnvFile(content) {
  return Object.fromEntries(
    content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separatorIndex = line.indexOf('=');
        if (separatorIndex === -1) {
          return [line, ''];
        }

        return [
          line.slice(0, separatorIndex),
          line.slice(separatorIndex + 1),
        ];
      }),
  );
}

async function readLocalEnvSecret() {
  const envPath = path.join(process.cwd(), '.env');

  try {
    const content = await readFile(envPath, 'utf8');
    const values = parseEnvFile(content);
    return values.CUBE_API_SECRET?.trim() || null;
  } catch {
    return null;
  }
}

async function main() {
  const secret =
    process.env.CUBE_API_SECRET?.trim() || (await readLocalEnvSecret());

  if (!secret) {
    throw new Error(
      'Missing CUBE_API_SECRET. Please set it in the shell or .env before generating a Cube dev token.',
    );
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    iat: issuedAt,
    exp: issuedAt + 60 * 60 * 24 * 30,
  };

  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret)
    .update(unsignedToken)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  process.stdout.write(`${unsignedToken}.${signature}\n`);
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Failed to generate Cube dev token.',
  );
  process.exit(1);
});
