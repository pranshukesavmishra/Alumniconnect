// Prints a new set of push keys (run once per deployment):  node scripts/generate-push-keys.mjs
// Put VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / PUSH_SECRET in the Supabase function secrets, and the same public key
// as VITE_VAPID_PUBLIC_KEY in the hosting environment. Never commit the private key or the secret.
const { subtle } = globalThis.crypto
const b64 = (b) => Buffer.from(b).toString('base64url')
const k = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const pub = b64(new Uint8Array(await subtle.exportKey('raw', k.publicKey)))
console.log(`VAPID_PUBLIC_KEY=${pub}`)
console.log(`VAPID_PRIVATE_KEY=${(await subtle.exportKey('jwk', k.privateKey)).d}`)
console.log(`PUSH_SECRET=${b64(globalThis.crypto.getRandomValues(new Uint8Array(24)))}`)
console.log(`VITE_VAPID_PUBLIC_KEY=${pub}`)
