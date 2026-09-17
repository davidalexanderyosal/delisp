/**
 * Cloudflare Access verification (spec §5). Access terminates authentication at
 * the edge and forwards a signed assertion; the Worker's job is to confirm the
 * assertion is genuine and issued for *this* application, so that a token minted
 * for some other app on the same team cannot be replayed here.
 *
 * Written against WebCrypto directly rather than a JWT library: it is one
 * RS256 signature check and a handful of claims, and the Workers runtime already
 * has everything needed.
 */

/** A JWK as Access publishes it — the runtime's `JsonWebKey` omits `kid`. */
export interface AccessJwk extends JsonWebKey {
  kid?: string;
}

export interface AccessIdentity {
  email: string | null;
  subject: string | null;
  expiresAt: number;
}

export interface VerifyOptions {
  teamDomain: string;
  aud: string;
  /** Injected in tests; defaults to fetching the team's public certificates. */
  fetchKeys?: (teamDomain: string) => Promise<AccessJwk[]>;
  /** Injected in tests. */
  now?: () => number;
}

export class AccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessError';
  }
}

function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson(segment: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(segment))) as Record<string, unknown>;
}

const keyCache = new Map<string, { keys: AccessJwk[]; fetchedAt: number }>();
const KEY_TTL_MS = 60 * 60 * 1000;

async function defaultFetchKeys(teamDomain: string): Promise<AccessJwk[]> {
  const cached = keyCache.get(teamDomain);
  if (cached && Date.now() - cached.fetchedAt < KEY_TTL_MS) return cached.keys;

  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new AccessError(`could not fetch Access certificates (${response.status})`);
  const body = (await response.json()) as { keys?: AccessJwk[] };
  const keys = body.keys ?? [];
  keyCache.set(teamDomain, { keys, fetchedAt: Date.now() });
  return keys;
}

/**
 * Verifies the `Cf-Access-Jwt-Assertion` header. Throws `AccessError` with a
 * reason on any failure; never returns a partially-checked identity.
 */
export async function verifyAccessJwt(
  token: string,
  options: VerifyOptions,
): Promise<AccessIdentity> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AccessError('malformed token');
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  const header = decodeJson(headerPart);
  if (header.alg !== 'RS256') throw new AccessError(`unsupported algorithm: ${String(header.alg)}`);

  const fetchKeys = options.fetchKeys ?? defaultFetchKeys;
  const keys = await fetchKeys(options.teamDomain);
  const candidates = header.kid ? keys.filter((k) => k.kid === header.kid) : keys;
  if (candidates.length === 0) throw new AccessError('no matching signing key');

  const data = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  const signature = base64UrlDecode(signaturePart);

  let verified = false;
  for (const jwk of candidates) {
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    if (await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data)) {
      verified = true;
      break;
    }
  }
  if (!verified) throw new AccessError('signature did not verify');

  const payload = decodeJson(payloadPart);
  const now = Math.floor((options.now?.() ?? Date.now()) / 1000);

  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  if (exp <= now) throw new AccessError('token has expired');

  const nbf = typeof payload.nbf === 'number' ? payload.nbf : null;
  if (nbf !== null && nbf > now) throw new AccessError('token is not yet valid');

  const issuer = typeof payload.iss === 'string' ? payload.iss : '';
  if (issuer !== `https://${options.teamDomain}`) throw new AccessError('unexpected issuer');

  // A token minted for a different Access application on the same team is a
  // valid signature over the wrong audience — the check that makes this useful.
  const aud = payload.aud;
  const audiences = Array.isArray(aud) ? aud : typeof aud === 'string' ? [aud] : [];
  if (!audiences.includes(options.aud)) throw new AccessError('audience does not match');

  return {
    email: typeof payload.email === 'string' ? payload.email : null,
    subject: typeof payload.sub === 'string' ? payload.sub : null,
    expiresAt: exp,
  };
}
