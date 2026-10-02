// Generates the RS256 keypair Convex Auth needs (same output as the
// `generateKeys.mjs` script in the Convex Auth manual-setup guide) and writes
// it to docker/.auth-keys.env (gitignored). Re-run after wiping the backend
// volume or when provisioning a new self-hosted backend, then set the vars:
//   set -a; . ./docker/.env.selfhosted; set +a
//   set -a; . ./docker/.auth-keys.env; set +a
//   npx convex env set JWT_PRIVATE_KEY "$JWT_PRIVATE_KEY"
//   npx convex env set JWKS "$JWKS"
import { writeFileSync } from "node:fs";
import { subtle } from "node:crypto";

const keys = await subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
);

const pkcs8 = Buffer.from(await subtle.exportKey("pkcs8", keys.privateKey))
  .toString("base64")
  .match(/.{1,64}/g)
  .join("\n");
const privateKey = `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----`
  .trimEnd()
  .replace(/\n/g, " ");

const publicJwk = await subtle.exportKey("jwk", keys.publicKey);
const jwks = JSON.stringify({
  keys: [{ use: "sig", kty: publicJwk.kty, n: publicJwk.n, e: publicJwk.e }],
});

writeFileSync(
  "docker/.auth-keys.env",
  `JWT_PRIVATE_KEY="${privateKey}"\nJWKS='${jwks}'\n`,
);
console.log("wrote docker/.auth-keys.env");
