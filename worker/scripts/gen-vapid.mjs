// VAPID 用の P-256 鍵ペアを作って標準出力に出すだけ（ファイルには書かない）
//   publicKey  … wrangler.toml の VAPID_PUBLIC_KEY とアプリ側の applicationServerKey に使う
//   privateJwk … `wrangler secret put VAPID_PRIVATE_JWK` で登録する。リポジトリに入れないこと

import { pathToFileURL } from 'node:url';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = await crypto.subtle.exportKey('raw', pair.publicKey); // 0x04 || x || y
  const { kty, crv, x, y, d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey: b64url(raw), privateJwk: JSON.stringify({ kty, crv, x, y, d }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await generateVapidKeys(), null, 2));
}
