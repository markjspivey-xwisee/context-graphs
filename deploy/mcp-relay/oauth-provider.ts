/**
 * Minimal OAuth 2.1 provider for the Interego MCP relay.
 *
 * Implements the MCP-required subset of OAuth 2.1 per the SDK's
 * OAuthServerProvider interface: DCR, authorization code + PKCE, token
 * exchange, token verification. In-memory state (lost on container restart)
 * — acceptable for a single-user personal deployment.
 *
 * Authorization is gated by a single RELAY_ADMIN_PASSWORD env var. The
 * authorize() method renders an HTML login form; the form POSTs to
 * /oauth/login (defined in server.ts) which calls completePendingAuthorization
 * to issue the code and redirect the user back to the client's redirect_uri.
 */
import type { Response } from 'express';
import { randomBytes, createHash } from 'node:crypto';

import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface InteregoAuthInfo extends AuthInfo {
  // Identity the provider asserts for this token — used by MCP handlers to
  // attribute writes to the authenticated user's home pod.
  extra?: {
    agentId: string;
    ownerWebId: string;
    userId: string;
  };
}

export class InteregoOAuthProvider implements OAuthServerProvider {
  private clients = new Map<string, OAuthClientInformationFull>();
  private authCodes = new Map<string, {
    clientId: string;
    codeChallenge: string;
    redirectUri: string;
    scopes: string[];
    expiresAt: number;
  }>();
  private accessTokens = new Map<string, InteregoAuthInfo>();
  private pendingAuthorizations = new Map<string, {
    client: OAuthClientInformationFull;
    params: AuthorizationParams;
    expiresAt: number;
  }>();

  constructor(
    private readonly cfg: {
      adminPassword: string;
      agentId: string;
      ownerWebId: string;
      userId: string;
      tokenTtlSec?: number;
    },
  ) {}

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: (clientId) => this.clients.get(clientId),
      registerClient: (clientData) => {
        const client_id = randomBytes(16).toString('hex');
        const client_id_issued_at = Math.floor(Date.now() / 1000);
        const registered: OAuthClientInformationFull = {
          ...clientData,
          client_id,
          client_id_issued_at,
        };
        this.clients.set(client_id, registered);
        return registered;
      },
    };
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    // Stash the request so the login POST can resume it by ID
    const pendingId = randomBytes(16).toString('hex');
    this.pendingAuthorizations.set(pendingId, {
      client,
      params,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const clientName = escapeHtml(client.client_name || '(unnamed client)');
    const scopeList = escapeHtml((params.scopes || ['mcp']).join(', '));
    const redirectHost = escapeHtml(new URL(params.redirectUri).host);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize \u2014 Interego</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; max-width: 420px; margin: 3em auto; padding: 0 1em; }
  h1 { font-size: 1.25em; margin: 0 0 .4em; }
  .sub { color: #666; font-size: .9em; margin-bottom: 1.2em; }
  .client { padding: 1em; border: 1px solid #ddd; border-radius: 8px; margin-bottom: 1.2em; }
  .client .name { font-weight: 600; }
  .client .meta { color: #666; font-size: .85em; margin-top: .3em; }
  label { display: block; margin: .8em 0 .3em; font-size: .9em; color: #333; }
  input[type=password] { width: 100%; padding: .6em; font-size: 1em; border: 1px solid #bbb; border-radius: 6px; box-sizing: border-box; }
  button { width: 100%; padding: .8em; font-size: 1em; background: #111; color: #fff; border: 0; border-radius: 6px; cursor: pointer; margin-top: 1.2em; }
  button:hover { background: #333; }
  .foot { margin-top: 1.5em; font-size: .8em; color: #888; text-align: center; }
  @media (prefers-color-scheme: dark) {
    body { background: #111; color: #eee; }
    .sub, .foot { color: #aaa; }
    .client { border-color: #333; }
    .client .meta { color: #aaa; }
    label { color: #ddd; }
    input[type=password] { background: #1a1a1a; color: #fff; border-color: #444; }
    button { background: #fff; color: #111; }
  }
</style>
</head>
<body>
  <h1>Authorize MCP access</h1>
  <div class="sub">The client below is asking to connect to your Interego pod.</div>
  <div class="client">
    <div class="name">${clientName}</div>
    <div class="meta">redirect: ${redirectHost} \u00b7 scopes: ${scopeList}</div>
  </div>
  <form method="POST" action="/oauth/login">
    <input type="hidden" name="pending_id" value="${escapeHtml(pendingId)}">
    <label for="pw">Admin password</label>
    <input id="pw" type="password" name="password" autofocus autocomplete="current-password" required>
    <button type="submit">Authorize</button>
  </form>
  <div class="foot">Interego MCP Relay</div>
</body>
</html>`);
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const c = this.authCodes.get(authorizationCode);
    if (!c) throw new Error('Invalid authorization code');
    return c.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    const c = this.authCodes.get(authorizationCode);
    if (!c) throw new Error('Invalid authorization code');
    // Single use
    this.authCodes.delete(authorizationCode);
    if (c.clientId !== client.client_id) throw new Error('Client ID mismatch');
    if (redirectUri && c.redirectUri !== redirectUri) throw new Error('Redirect URI mismatch');
    if (c.expiresAt < Date.now()) throw new Error('Authorization code expired');

    const token = randomBytes(32).toString('hex');
    const expiresIn = this.cfg.tokenTtlSec ?? 3600;
    this.accessTokens.set(token, {
      token,
      clientId: client.client_id,
      scopes: c.scopes,
      expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
      extra: {
        agentId: this.cfg.agentId,
        ownerWebId: this.cfg.ownerWebId,
        userId: this.cfg.userId,
      },
    });
    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: expiresIn,
      scope: c.scopes.join(' '),
    };
  }

  async exchangeRefreshToken(): Promise<OAuthTokens> {
    throw new Error('Refresh tokens not supported');
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const info = this.accessTokens.get(token);
    if (!info) throw new Error('Invalid token');
    if (info.expiresAt && info.expiresAt * 1000 < Date.now()) {
      this.accessTokens.delete(token);
      throw new Error('Token expired');
    }
    return info;
  }

  /**
   * Called by the /oauth/login POST handler after password validation.
   * Issues an authorization code bound to the pending authorization and
   * returns the redirect target for the user's browser.
   */
  completePendingAuthorization(pendingId: string): { redirectUri: string; code: string; state?: string } | null {
    const pending = this.pendingAuthorizations.get(pendingId);
    if (!pending) return null;
    if (pending.expiresAt < Date.now()) {
      this.pendingAuthorizations.delete(pendingId);
      return null;
    }
    this.pendingAuthorizations.delete(pendingId);

    const code = randomBytes(32).toString('hex');
    this.authCodes.set(code, {
      clientId: pending.client.client_id,
      codeChallenge: pending.params.codeChallenge,
      redirectUri: pending.params.redirectUri,
      scopes: pending.params.scopes || ['mcp'],
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    return {
      redirectUri: pending.params.redirectUri,
      code,
      state: pending.params.state,
    };
  }

  checkAdminPassword(candidate: string): boolean {
    if (!this.cfg.adminPassword) return false;
    return timingSafeEqual(candidate, this.cfg.adminPassword);
  }
}

// Suppress unused-import lint if createHash is not used elsewhere
void createHash;
