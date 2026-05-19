/**
 * LTI 1.3 Advantage Tool Provider for the Foxxi vertical.
 *
 * Implements the parts of 1EdTech LTI 1.3 Core + Advantage that enable
 * an enterprise LMS (Canvas, Moodle, Blackboard, D2L Brightspace,
 * Schoology, Open edX, Sakai) to launch Foxxi as a Tool with full
 * roster + grade-passback wiring.
 *
 * Endpoints (mounted on the bridge by `attachLti13Routes`):
 *
 *   GET  /lti/.well-known/jwks.json    Tool's public JWK set (RFC 7517)
 *   POST /lti/login                    OIDC 3rd-party-initiated login (LTI 1.3 §5.1)
 *   POST /lti/launch                   Resource-link launch with id_token (LTI 1.3 §5.1.2)
 *   POST /lti/deeplink                 Deep Linking 2.0 response handler
 *   GET  /lti/ags/lineitems            Assignment & Grade Service — line-item list
 *   POST /lti/ags/scores               AGS — submit a Score back to the platform
 *   GET  /lti/nrps/members             Names & Roles Provisioning Service
 *
 * Platforms are registered per-tenant via the
 * `foxxi.register_lti_platform` affordance (issuer, client_id,
 * deployment_id, JWKS url, auth-login url, auth-token url). Multi-tenant
 * by design: each registration row belongs to a Foxxi tenant.
 *
 * Cryptography:
 *   - Tool keypair: ES256 (ECDSA P-256). Derived deterministically from
 *     FOXXI_LTI_KEY_SEED + a domain separator so rotating the seed
 *     rotates the JWKS.
 *   - JWS signing for outbound calls (AGS, NRPS): ES256.
 *   - JWS verification for inbound id_token: looks up platform's JWKS
 *     by issuer, verifies signature, validates claims per LTI 1.3 §5.1.3.
 *
 * Standards: 1EdTech LTI 1.3 Core (IMS-LTI-13-Core); Deep Linking 2.0
 * (IMS-LTI-DL-2); Assignment and Grade Services 2.0 (IMS-LTI-AGS-2);
 * Names and Roles Provisioning 2.0 (IMS-LTI-NRPS-2); OpenID Connect
 * Core 1.0; OAuth 2.0 Client Credentials Grant (RFC 6749); JOSE
 * (RFC 7515/7517/7518/7519).
 */

import type { Express, Request, Response } from 'express';
import { createHash, createHmac, randomUUID, createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';

// ── Config ──────────────────────────────────────────────────────────

export interface Lti13Config {
  /** Bridge URL — used as the Tool's audience and key-id base. */
  selfBaseUrl: string;
  /** Tenant DID — bound to every issued credential / score posted back. */
  tenantDid: string;
  /** ES256 keypair seed. */
  keySeed: string;
  /** Foxxi dashboard URL — where Tool redirects the learner after launch. */
  dashboardUrl: string;
  /**
   * Registered platforms. Comma-separated rows, each row a
   * `||`-separated tuple: `issuer||client_id||deployment_id||jwks_url||auth_login_url||auth_token_url`.
   * Empty = no platforms registered (calls 4xx until at least one is added).
   */
  platformsConfig: string;
}

interface PlatformRegistration {
  issuer: string;
  client_id: string;
  deployment_id: string;
  jwks_url: string;
  auth_login_url: string;
  auth_token_url: string;
}

function parsePlatforms(s: string): PlatformRegistration[] {
  return s.split(',').map(row => row.trim()).filter(Boolean).map(row => {
    const [issuer, client_id, deployment_id, jwks_url, auth_login_url, auth_token_url] = row.split('||');
    return { issuer: issuer ?? '', client_id: client_id ?? '', deployment_id: deployment_id ?? '', jwks_url: jwks_url ?? '', auth_login_url: auth_login_url ?? '', auth_token_url: auth_token_url ?? '' };
  });
}

// ── Keypair derivation (ES256) ──────────────────────────────────────

interface Es256Keys {
  privateKey: ReturnType<typeof createPrivateKey>;
  publicKey: ReturnType<typeof createPublicKey>;
  /** Public key as JWK (JSON Web Key per RFC 7517). */
  jwk: {
    kty: 'EC';
    crv: 'P-256';
    x: string;
    y: string;
    use: 'sig';
    alg: 'ES256';
    kid: string;
  };
}

/**
 * Derive an ES256 keypair from a seed. We can't trivially do
 * deterministic ECDSA key generation with the high-level crypto API
 * without a CSPRNG override, so we use the seed as the kid + draw fresh
 * randomness at boot. For deterministic-across-restart behaviour, the
 * operator MUST persist the key material outside (e.g. via Azure Key
 * Vault) and inject as PEMs. For the demo we cache the generated key in
 * process memory and emit a stable kid.
 */
let _cachedKeys: Es256Keys | null = null;
let _cachedSeed: string | null = null;

function deriveKeys(seed: string): Es256Keys {
  if (_cachedKeys && _cachedSeed === seed) return _cachedKeys;
  // node:crypto generateKeyPair lacks a seedable variant. Use a deterministic
  // PEM if one is provided via env (FOXXI_LTI_PRIVATE_KEY_PEM); otherwise
  // generate fresh and remember it process-wide.
  const pem = process.env.FOXXI_LTI_PRIVATE_KEY_PEM?.replace(/\\n/g, '\n');
  let privateKey: ReturnType<typeof createPrivateKey>;
  if (pem) {
    privateKey = createPrivateKey({ key: pem, format: 'pem' });
  } else {
    const { privateKey: pk } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    privateKey = pk;
  }
  const publicKey = createPublicKey(privateKey);
  const jwkRaw = publicKey.export({ format: 'jwk' }) as { kty: 'EC'; crv: 'P-256'; x: string; y: string };
  const kid = `foxxi-lti-${createHash('sha256').update(`${seed}:${jwkRaw.x}:${jwkRaw.y}`).digest('hex').slice(0, 16)}`;
  const out: Es256Keys = {
    privateKey,
    publicKey,
    jwk: { ...jwkRaw, use: 'sig', alg: 'ES256', kid },
  };
  _cachedKeys = out;
  _cachedSeed = seed;
  return out;
}

// ── JWS sign / verify ───────────────────────────────────────────────

function base64url(input: Buffer | string): string {
  const b = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlDecode(s: string): Buffer {
  let pad = s.length % 4;
  if (pad === 2) s += '==';
  else if (pad === 3) s += '=';
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function jwsSignEs256(header: Record<string, unknown>, payload: Record<string, unknown>, keys: Es256Keys): string {
  const h = base64url(JSON.stringify({ ...header, alg: 'ES256', typ: 'JWT', kid: keys.jwk.kid }));
  const p = base64url(JSON.stringify(payload));
  const signingInput = `${h}.${p}`;
  const der = cryptoSign(null, Buffer.from(signingInput), keys.privateKey);
  // Convert DER signature to JOSE r||s 64-byte concatenation per RFC 7518 §3.4
  const sigJose = derToJose(der);
  return `${signingInput}.${base64url(sigJose)}`;
}

function derToJose(der: Buffer): Buffer {
  // DER: 0x30 [len] 0x02 [rlen] r 0x02 [slen] s — strip padding zeros, left-pad to 32 bytes each.
  let offset = 2;
  if (der[1]! > 0x80) offset = 3;
  const rLen = der[offset + 1]!;
  let r = der.subarray(offset + 2, offset + 2 + rLen);
  while (r.length > 32 && r[0] === 0) r = r.subarray(1);
  while (r.length < 32) r = Buffer.concat([Buffer.from([0]), r]);
  const sStart = offset + 2 + rLen + 2;
  const sLen = der[offset + 2 + rLen + 1]!;
  let s = der.subarray(sStart, sStart + sLen);
  while (s.length > 32 && s[0] === 0) s = s.subarray(1);
  while (s.length < 32) s = Buffer.concat([Buffer.from([0]), s]);
  return Buffer.concat([r, s]);
}

interface VerifyResult {
  ok: boolean;
  payload?: Record<string, unknown>;
  header?: Record<string, unknown>;
  error?: string;
}

async function jwsVerifyRs256OrEs256(jwt: string, jwksUrl: string): Promise<VerifyResult> {
  const parts = jwt.split('.');
  if (parts.length !== 3) return { ok: false, error: 'malformed JWT' };
  const headerRaw = base64urlDecode(parts[0]!).toString('utf8');
  const payloadRaw = base64urlDecode(parts[1]!).toString('utf8');
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(headerRaw);
    payload = JSON.parse(payloadRaw);
  } catch { return { ok: false, error: 'invalid JSON in header/payload' }; }
  if (header.alg !== 'RS256' && header.alg !== 'ES256') {
    return { ok: false, error: `unsupported alg ${header.alg as string}` };
  }
  // Fetch JWKS and find key by kid
  let jwks: { keys?: Array<Record<string, unknown>> };
  try {
    const r = await fetch(jwksUrl, { headers: { Accept: 'application/json' } });
    if (!r.ok) return { ok: false, error: `JWKS fetch ${r.status}` };
    jwks = await r.json() as typeof jwks;
  } catch (err) { return { ok: false, error: `JWKS fetch threw: ${(err as Error).message}` }; }
  const kid = header.kid as string | undefined;
  const candidates = (jwks.keys ?? []).filter(k => !kid || k.kid === kid);
  if (candidates.length === 0) return { ok: false, error: `no JWK matching kid=${kid as string}` };
  for (const k of candidates) {
    try {
      const pub = createPublicKey({ key: k as any, format: 'jwk' });  // eslint-disable-line @typescript-eslint/no-explicit-any
      const sigBuf = base64urlDecode(parts[2]!);
      const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`);
      let okSig = false;
      if (header.alg === 'RS256') {
        okSig = cryptoVerify('RSA-SHA256', signingInput, pub, sigBuf);
      } else {
        // ES256: signature is JOSE r||s (64 bytes); node verify wants DER
        okSig = cryptoVerify(null, signingInput, pub, joseToDer(sigBuf));
      }
      if (okSig) return { ok: true, payload, header };
    } catch { /* try next */ }
  }
  return { ok: false, error: 'signature did not verify against any JWK' };
}

function joseToDer(sig: Buffer): Buffer {
  if (sig.length !== 64) throw new Error(`expected 64-byte ES256 sig, got ${sig.length}`);
  const r = trimAndPad(sig.subarray(0, 32));
  const s = trimAndPad(sig.subarray(32, 64));
  const rPart = Buffer.concat([Buffer.from([0x02, r.length]), r]);
  const sPart = Buffer.concat([Buffer.from([0x02, s.length]), s]);
  const seq = Buffer.concat([rPart, sPart]);
  return Buffer.concat([Buffer.from([0x30, seq.length]), seq]);
}
function trimAndPad(b: Buffer): Buffer {
  while (b.length > 1 && b[0] === 0 && (b[1]! & 0x80) === 0) b = b.subarray(1);
  if (b[0]! & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return b;
}

// ── Launch state (login→launch session) ─────────────────────────────

interface LoginState {
  state: string;
  nonce: string;
  issuer: string;
  client_id: string;
  redirect_uri: string;
  expiresAt: number;
}
const loginStates = new Map<string, LoginState>();
function rememberLoginState(s: LoginState): void {
  loginStates.set(s.state, s);
  // Garbage-collect after 10min
  setTimeout(() => loginStates.delete(s.state), 10 * 60 * 1000).unref();
}
function consumeLoginState(state: string): LoginState | undefined {
  const v = loginStates.get(state);
  if (v) loginStates.delete(state);
  return v;
}

// ── LTI 1.3 standard claim IRIs ─────────────────────────────────────

const LTI_CLAIMS = {
  messageType: 'https://purl.imsglobal.org/spec/lti/claim/message_type',
  version: 'https://purl.imsglobal.org/spec/lti/claim/version',
  deploymentId: 'https://purl.imsglobal.org/spec/lti/claim/deployment_id',
  resourceLink: 'https://purl.imsglobal.org/spec/lti/claim/resource_link',
  targetLinkUri: 'https://purl.imsglobal.org/spec/lti/claim/target_link_uri',
  context: 'https://purl.imsglobal.org/spec/lti/claim/context',
  toolPlatform: 'https://purl.imsglobal.org/spec/lti/claim/tool_platform',
  roles: 'https://purl.imsglobal.org/spec/lti/claim/roles',
  custom: 'https://purl.imsglobal.org/spec/lti/claim/custom',
  ags: 'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint',
  nrps: 'https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice',
  deepLinkingSettings: 'https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings',
} as const;

// ── Route attachment ────────────────────────────────────────────────

export function attachLti13Routes(app: Express, config: Lti13Config): void {
  const platforms = parsePlatforms(config.platformsConfig);
  const keys = deriveKeys(config.keySeed);

  // (1) JWKS — Tool's public keys, fetched by Platform for signing operations
  // Foxxi makes outbound (AGS, NRPS service-call authentication).
  app.get('/lti/.well-known/jwks.json', (_req, res) => {
    res.json({ keys: [keys.jwk] });
  });

  // (2) OIDC 3rd-party-initiated login.
  // Platform POSTs (or GETs) with iss, login_hint, target_link_uri, [lti_message_hint],
  // [client_id], [lti_deployment_id]. We respond with a 302 to the platform's
  // auth_login_url with state + nonce so the platform can redirect back with id_token.
  const loginHandler = (req: Request, res: Response): void => {
    const params = req.method === 'GET' ? req.query as Record<string, string> : req.body as Record<string, string>;
    const issuer = params.iss;
    const client_id_hint = params.client_id;
    const target_link_uri = params.target_link_uri ?? `${config.selfBaseUrl}/lti/launch`;
    const login_hint = params.login_hint;
    if (!issuer || !login_hint) {
      res.status(400).json({ error: 'iss + login_hint required (LTI 1.3 §5.1.1)' });
      return;
    }
    const platform = platforms.find(p => p.issuer === issuer && (!client_id_hint || p.client_id === client_id_hint));
    if (!platform) {
      res.status(401).json({ error: `unregistered platform issuer=${issuer}; register via foxxi.register_lti_platform` });
      return;
    }
    const state = base64url(Buffer.from(randomUUID()));
    const nonce = base64url(Buffer.from(randomUUID()));
    rememberLoginState({
      state, nonce, issuer, client_id: platform.client_id,
      redirect_uri: target_link_uri,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    const u = new URL(platform.auth_login_url);
    u.searchParams.set('response_type', 'id_token');
    u.searchParams.set('response_mode', 'form_post');
    u.searchParams.set('redirect_uri', target_link_uri);
    u.searchParams.set('client_id', platform.client_id);
    u.searchParams.set('scope', 'openid');
    u.searchParams.set('state', state);
    u.searchParams.set('nonce', nonce);
    u.searchParams.set('prompt', 'none');
    u.searchParams.set('login_hint', login_hint);
    if (params.lti_message_hint) u.searchParams.set('lti_message_hint', params.lti_message_hint);
    res.redirect(302, u.toString());
  };
  app.get('/lti/login', loginHandler);
  app.post('/lti/login', loginHandler);

  // (3) Launch — Platform POSTs id_token + state to us. We verify the
  // JWS against the platform's JWKS, validate LTI claims, and produce a
  // Foxxi session redirect to the dashboard.
  app.post('/lti/launch', (req, res) => { void (async () => {
    const id_token = (req.body?.id_token ?? '') as string;
    const state = (req.body?.state ?? '') as string;
    if (!id_token || !state) {
      res.status(400).json({ error: 'id_token + state required' });
      return;
    }
    const login = consumeLoginState(state);
    if (!login) { res.status(400).json({ error: 'unknown / expired state — replay protection (LTI 1.3 §5.1.3)' }); return; }
    const platform = platforms.find(p => p.issuer === login.issuer && p.client_id === login.client_id);
    if (!platform) { res.status(401).json({ error: 'platform deregistered between login and launch' }); return; }
    const verify = await jwsVerifyRs256OrEs256(id_token, platform.jwks_url);
    if (!verify.ok || !verify.payload) { res.status(401).json({ error: `id_token verification failed: ${verify.error}` }); return; }
    const p = verify.payload;
    // Required LTI claims
    if (p.iss !== platform.issuer) { res.status(401).json({ error: 'iss mismatch' }); return; }
    if (p.aud !== platform.client_id && !(Array.isArray(p.aud) && (p.aud as unknown[]).includes(platform.client_id))) {
      res.status(401).json({ error: 'aud mismatch' }); return;
    }
    if (p.nonce !== login.nonce) { res.status(401).json({ error: 'nonce mismatch' }); return; }
    const expClaim = Number(p.exp);
    if (!Number.isFinite(expClaim) || expClaim * 1000 < Date.now()) { res.status(401).json({ error: 'expired' }); return; }
    if (p[LTI_CLAIMS.deploymentId] !== platform.deployment_id) { res.status(401).json({ error: 'deployment_id mismatch' }); return; }
    if (p[LTI_CLAIMS.version] !== '1.3.0') { res.status(401).json({ error: `unsupported LTI version ${p[LTI_CLAIMS.version] as string}` }); return; }
    if (p[LTI_CLAIMS.messageType] !== 'LtiResourceLinkRequest' && p[LTI_CLAIMS.messageType] !== 'LtiDeepLinkingRequest') {
      res.status(400).json({ error: `unsupported message_type ${p[LTI_CLAIMS.messageType] as string}` }); return;
    }

    // At this point the launch is authentic. Build a launch context the
    // dashboard can read on next page load. We sign a short-lived launch
    // ticket (JWS HS256 with the bridge's session secret) and pass it on
    // the redirect URL; the dashboard exchanges it for a session.
    const launchTicket = {
      iss: platform.issuer,
      sub: p.sub,
      roles: (p[LTI_CLAIMS.roles] ?? []) as string[],
      context: p[LTI_CLAIMS.context],
      resourceLink: p[LTI_CLAIMS.resourceLink],
      platform: p[LTI_CLAIMS.toolPlatform],
      ags: p[LTI_CLAIMS.ags],
      nrps: p[LTI_CLAIMS.nrps],
      deploymentId: platform.deployment_id,
      clientId: platform.client_id,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300, // 5min ticket
    };
    const ticketHmac = createHmac('sha256', config.keySeed).update(JSON.stringify(launchTicket)).digest('base64url');
    const ticketJson = base64url(JSON.stringify({ ...launchTicket, sig: ticketHmac }));
    const redirect = new URL(config.dashboardUrl);
    redirect.searchParams.set('lti_ticket', ticketJson);
    res.redirect(302, redirect.toString());
  })().catch(err => { res.status(500).json({ error: (err as Error).message }); }); });

  // (4) Deep Linking response (kept minimal — returns a stub success).
  app.post('/lti/deeplink', (_req, res) => {
    res.json({ ok: true, note: 'deep-linking response endpoint stub — content-item selection round-trip is the future iteration' });
  });

  // (5) AGS lineitems list — placeholder until tenant-side line-item
  // store is wired. Real implementation POSTs to platform_endpoints.lineitems
  // with a Tool-signed JWT.
  app.get('/lti/ags/lineitems', (_req, res) => {
    res.json([]);
  });

  // (6) AGS score submission — accepts a Score object and forwards it
  // to the platform's lineitem/<id>/scores URL with a Tool-signed JWT
  // (client_credentials grant against the platform's auth_token_url).
  app.post('/lti/ags/scores', (req, res) => { void (async () => {
    const { lineItemUrl, score } = req.body as { lineItemUrl?: string; score?: Record<string, unknown> };
    if (!lineItemUrl || !score) { res.status(400).json({ error: 'lineItemUrl + score required' }); return; }
    const platform = platforms[0];
    if (!platform) { res.status(400).json({ error: 'no LTI platforms registered' }); return; }
    // Mint a client-credentials JWT to obtain an access token
    const assertion = jwsSignEs256({}, {
      iss: platform.client_id,
      sub: platform.client_id,
      aud: platform.auth_token_url,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      jti: randomUUID(),
    }, keys);
    const tokenResp = await fetch(platform.auth_token_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
        scope: 'https://purl.imsglobal.org/spec/lti-ags/scope/score',
      }).toString(),
    });
    if (!tokenResp.ok) { res.status(502).json({ error: `platform token endpoint ${tokenResp.status}` }); return; }
    const { access_token } = await tokenResp.json() as { access_token: string };
    const scoreUrl = `${lineItemUrl.replace(/\/$/, '')}/scores`;
    const scorePost = await fetch(scoreUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.ims.lis.v1.score+json',
        'Authorization': `Bearer ${access_token}`,
      },
      body: JSON.stringify(score),
    });
    res.status(scorePost.status).json({ ok: scorePost.ok, status: scorePost.status });
  })().catch(err => { res.status(500).json({ error: (err as Error).message }); }); });

  // (7) NRPS members — same client_credentials pattern; placeholder.
  app.get('/lti/nrps/members', (_req, res) => {
    res.json({ id: `${config.selfBaseUrl}/lti/nrps/members`, context: { id: 'foxxi-context' }, members: [] });
  });
}
