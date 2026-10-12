import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

test('Service Worker のキャッシュ一覧にアプリのファイルが全部入っている', () => {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const listed = new Set([...sw.matchAll(/'([^']+\.(?:js|css|md|png|webmanifest|html))'/g)].map((m) => m[1]));
  const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  for (const f of [...walk('js'), ...walk('css'), ...walk('icons'), 'data/cards.md', 'index.html', 'manifest.webmanifest']) {
    assert.ok(listed.has(f), `${f} が sw.js の APP_FILES にない`);
  }
  for (const f of listed) assert.ok(fs.existsSync(path.join(root, f)), `${f} が存在しない`);
});
