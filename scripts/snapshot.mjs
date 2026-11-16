// Fetch a user's town at build time and save it as a static JSON snapshot in
// dist/, so the deployed page can open that town without spending the
// visitor's 60-requests-per-hour GitHub API quota.
//
// Usage: GITHUB_TOKEN=... node scripts/snapshot.mjs <user> [<user> ...]
// The token stays in CI; only public repository data is written out.
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

const users = process.argv.slice(2);
if (!users.length) {
  console.error('usage: node scripts/snapshot.mjs <user> [<user> ...]');
  process.exit(1);
}

const token = process.env.GITHUB_TOKEN?.trim() || null;
if (!token) console.warn('GITHUB_TOKEN is not set; using the anonymous 60/hour limit.');

// Reuse the app's own fetch + ghost classification through Vite's SSR loader.
const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

let failed = false;
try {
  const { fetchTown } = await vite.ssrLoadModule('/src/github.ts');
  await mkdir('dist/snapshots', { recursive: true });
  for (const user of users) {
    try {
      const data = await fetchTown(user, { token });
      // The token's quota means nothing to visitors; mark the data as a snapshot instead.
      const snapshot = { ...data, rateLimit: null, snapshot: true };
      const file = `dist/snapshots/${data.profile.login.toLowerCase()}.json`;
      await writeFile(file, JSON.stringify(snapshot));
      console.log(`${file}: ${data.repos.length} repos`);
    } catch (error) {
      failed = true;
      console.error(`snapshot for ${user} failed:`, error instanceof Error ? error.message : error);
    }
  }
} finally {
  await vite.close();
}
process.exit(failed ? 1 : 0);
