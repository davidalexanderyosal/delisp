import { beforeAll, describe, expect, it } from 'vitest';
import { AccessError, type AccessJwk, verifyAccessJwt } from '../src/access';

const TEAM = 'team.cloudflareaccess.com';
const AUD = 'aud-tag-for-this-app';
const KID = 'test-key-1';
const NOW_MS = Date.UTC(2026, 0, 1);

let signingKey: CryptoKey;
let publicJwk: AccessJwk;
let otherSigningKey: CryptoKey;

function b64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeSegment(value: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}

async function makeToken(
  claims: Record<string, unknown> = {},
  { header = {}, key = signingKey }: { header?: Record<string, unknown>; key?: CryptoKey } = {},
): Promise<string> {
  const head = encodeSegment({ alg: 'RS256', typ: 'JWT', kid: KID, ...header });
  const payload = encodeSegment({
    iss: `https://${TEAM}`,
    aud: AUD,
    sub: 'user-123',
    email: 'someone@example.com',
    exp: Math.floor(NOW_MS / 1000) + 3600,
    iat: Math.floor(NOW_MS / 1000),
    ...claims,
  });
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${head}.${payload}`),
  );
  return `${head}.${payload}.${b64url(new Uint8Array(signature))}`;
}

const options = (overrides: Record<string, unknown> = {}) => ({
  teamDomain: TEAM,
  aud: AUD,
  fetchKeys: async () => [publicJwk],
  now: () => NOW_MS,
  ...overrides,
});

beforeAll(async () => {
  const params = {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  } as const;
  const pair = (await crypto.subtle.generateKey(params, true, ['sign', 'verify'])) as CryptoKeyPair;
  signingKey = pair.privateKey;
  publicJwk = { ...((await crypto.subtle.exportKey('jwk', pair.publicKey)) as AccessJwk), kid: KID };

  const other = (await crypto.subtle.generateKey(params, true, ['sign', 'verify'])) as CryptoKeyPair;
  otherSigningKey = other.privateKey;
});

describe('verifyAccessJwt', () => {
  it('accepts a well-formed assertion and returns the identity', async () => {
    const identity = await verifyAccessJwt(await makeToken(), options());
    expect(identity.email).toBe('someone@example.com');
    expect(identity.subject).toBe('user-123');
  });

  it('rejects a token signed by a different key', async () => {
    const token = await makeToken({}, { key: otherSigningKey });
    await expect(verifyAccessJwt(token, options())).rejects.toThrow(/signature did not verify/);
  });

  it('rejects a token whose payload was edited after signing', async () => {
    const token = await makeToken();
    const [head, , signature] = token.split('.') as [string, string, string];
    const forged = encodeSegment({
      iss: `https://${TEAM}`,
      aud: AUD,
      email: 'attacker@example.com',
      exp: Math.floor(NOW_MS / 1000) + 3600,
    });
    await expect(
      verifyAccessJwt(`${head}.${forged}.${signature}`, options()),
    ).rejects.toThrow(/signature did not verify/);
  });

  it('rejects a token minted for a different Access application', async () => {
    // A valid signature over the wrong audience: the check that stops a token
    // from another app on the same team being replayed here.
    const token = await makeToken({ aud: 'some-other-app' });
    await expect(verifyAccessJwt(token, options())).rejects.toThrow(/audience does not match/);
  });

  it('accepts an audience list that contains this application', async () => {
    const token = await makeToken({ aud: ['some-other-app', AUD] });
    await expect(verifyAccessJwt(token, options())).resolves.toBeTruthy();
  });

  it('rejects an expired token', async () => {
    const token = await makeToken({ exp: Math.floor(NOW_MS / 1000) - 1 });
    await expect(verifyAccessJwt(token, options())).rejects.toThrow(/expired/);
  });

  it('rejects a token that is not valid yet', async () => {
    const token = await makeToken({ nbf: Math.floor(NOW_MS / 1000) + 60 });
    await expect(verifyAccessJwt(token, options())).rejects.toThrow(/not yet valid/);
  });

  it('rejects a token from another issuer', async () => {
    const token = await makeToken({ iss: 'https://evil.cloudflareaccess.com' });
    await expect(verifyAccessJwt(token, options())).rejects.toThrow(/unexpected issuer/);
  });

  it('refuses "alg": "none" rather than skipping the signature check', async () => {
    const token = await makeToken({}, { header: { alg: 'none' } });
    await expect(verifyAccessJwt(token, options())).rejects.toThrow(/unsupported algorithm/);
  });

  it('refuses a symmetric algorithm, which would let the public key sign', async () => {
    const token = await makeToken({}, { header: { alg: 'HS256' } });
    await expect(verifyAccessJwt(token, options())).rejects.toThrow(/unsupported algorithm/);
  });

  it('rejects a token whose kid matches no published key', async () => {
    const token = await makeToken({}, { header: { kid: 'unknown-key' } });
    await expect(verifyAccessJwt(token, options())).rejects.toThrow(/no matching signing key/);
  });

  it('rejects anything that is not three segments', async () => {
    await expect(verifyAccessJwt('nonsense', options())).rejects.toThrow(/malformed token/);
    await expect(verifyAccessJwt('a.b', options())).rejects.toThrow(/malformed token/);
  });

  it('throws AccessError, so the route can report a reason without leaking internals', async () => {
    await expect(verifyAccessJwt('nonsense', options())).rejects.toBeInstanceOf(AccessError);
  });

  it('tries every published key when the token carries no kid', async () => {
    const token = await makeToken({}, { header: { kid: undefined } });
    await expect(verifyAccessJwt(token, options())).resolves.toBeTruthy();
  });
});
