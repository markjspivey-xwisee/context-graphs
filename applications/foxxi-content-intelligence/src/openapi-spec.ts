/**
 * OpenAPI 3.1 + Swagger UI for the Foxxi bridge.
 *
 * Generates a machine-readable contract from the affordance list (the
 * single source of truth for Foxxi's MCP surface) plus the manually
 * declared LRS / LTI / OneRoster endpoints. Lets partner-eng teams
 * generate typed SDKs (openapi-generator / swagger-codegen) instead of
 * hand-rolling MCP JSON-RPC clients.
 *
 *   GET /openapi.json     OpenAPI 3.1.0 document
 *   GET /docs             Swagger UI loaded from cdn.jsdelivr.net
 */

import type { Express, Request, Response } from 'express';
import type { Affordance } from '../../_shared/affordance-mcp/index.js';

interface Config {
  selfBaseUrl: string;
  affordances: ReadonlyArray<Affordance>;
}

function affordanceParamSchema(p: { type: string; required?: boolean; description?: string }): Record<string, unknown> {
  const typeMap: Record<string, string> = {
    string: 'string',
    number: 'number',
    integer: 'integer',
    boolean: 'boolean',
    object: 'object',
    array: 'array',
  };
  return {
    type: typeMap[p.type] ?? 'string',
    description: p.description ?? '',
  };
}

function affordanceToOperation(a: Affordance, baseUrl: string): Record<string, unknown> {
  void baseUrl;
  const args = a.inputs ?? [];
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const arg of args) {
    properties[arg.name] = affordanceParamSchema(arg);
    if (arg.required) required.push(arg.name);
  }
  return {
    summary: a.title,
    description: a.description,
    operationId: a.toolName.replace(/[^a-zA-Z0-9]/g, '_'),
    tags: [a.toolName.split('.')[0] ?? 'foxxi'],
    requestBody: {
      required: required.length > 0,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required,
            properties,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Affordance handler response (JSON shape varies by tool — see individual handler docs)',
        content: { 'application/json': { schema: { type: 'object' } } },
      },
      401: { description: 'Missing / invalid session token (when FOXXI_REQUIRE_AUTH=true)' },
      403: { description: 'Forbidden by ABAC policy' },
      429: { description: 'Per-IP rate limit (10 calls per 5 min on agentic / LLM-backed handlers)' },
    },
    security: [{ bearerAuth: [] }],
    'x-mcp-invocation': {
      method: 'POST /mcp',
      jsonrpc: { method: 'tools/call', params: { name: a.toolName, arguments: '<arguments>' } },
      note: `This affordance is normally invoked via MCP JSON-RPC at ${baseUrl}/mcp. The /tools/${a.toolName} route below is the REST projection for non-MCP consumers.`,
    },
  };
}

function buildOpenApiDoc(config: Config): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  // Affordance-projected REST endpoints
  for (const a of config.affordances) {
    paths[`/tools/${a.toolName}`] = {
      post: affordanceToOperation(a, config.selfBaseUrl),
    };
  }

  // MCP envelope endpoint (for completeness)
  paths['/mcp'] = {
    post: {
      summary: 'MCP JSON-RPC endpoint (tools/list, tools/call)',
      description: 'Canonical MCP envelope: JSON-RPC 2.0 with method=tools/list (returns the affordance manifest) or tools/call (invokes a named affordance with arguments).',
      operationId: 'mcp_jsonrpc',
      tags: ['mcp'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['jsonrpc', 'method'],
              properties: {
                jsonrpc: { type: 'string', enum: ['2.0'] },
                id: { type: 'string' },
                method: { type: 'string', enum: ['tools/list', 'tools/call'] },
                params: { type: 'object' },
              },
            },
          },
        },
      },
      responses: { 200: { description: 'JSON-RPC response envelope' } },
    },
  };

  // xAPI 2.0 endpoints
  paths['/xapi/about'] = { get: { summary: 'xAPI 2.0 About', tags: ['xapi-lrs'], responses: { 200: { description: 'Returns versions + extensions per xAPI 2.0 §7.7' } } } };
  paths['/xapi/statements'] = {
    post: {
      summary: 'POST statements (xAPI 2.0 §7.2)', tags: ['xapi-lrs'],
      requestBody: { required: true, content: { 'application/json': { schema: { description: 'Single Statement or array of Statements', oneOf: [{ type: 'object' }, { type: 'array', items: { type: 'object' } }] } } } },
      responses: { 200: { description: 'Array of stored Statement IDs' } },
    },
    put: {
      summary: 'PUT statement (caller-provided UUID)', tags: ['xapi-lrs'],
      parameters: [{ name: 'statementId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
      responses: { 204: { description: 'Stored' } },
    },
    get: {
      summary: 'GET statements (filtered query)', tags: ['xapi-lrs'],
      parameters: [
        { name: 'statementId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'voidedStatementId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'agent', in: 'query', schema: { type: 'string', description: 'JSON-encoded Agent object' } },
        { name: 'verb', in: 'query', schema: { type: 'string', format: 'uri' } },
        { name: 'activity', in: 'query', schema: { type: 'string', format: 'uri' } },
        { name: 'since', in: 'query', schema: { type: 'string', format: 'date-time' } },
        { name: 'until', in: 'query', schema: { type: 'string', format: 'date-time' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 500 } },
        { name: 'ascending', in: 'query', schema: { type: 'boolean' } },
      ],
      responses: { 200: { description: 'Statement result with optional `more` continuation' } },
    },
  };
  for (const slug of ['activities/state', 'activities/profile', 'agents/profile']) {
    paths[`/xapi/${slug}`] = {
      get: { summary: `xAPI 2.0 ${slug} resource (GET)`, tags: ['xapi-lrs'], responses: { 200: { description: 'Document body' }, 404: { description: 'No document at key' } } },
      put: { summary: `xAPI 2.0 ${slug} resource (PUT)`, tags: ['xapi-lrs'], responses: { 204: { description: 'Stored' } } },
      post: { summary: `xAPI 2.0 ${slug} resource (POST)`, tags: ['xapi-lrs'], responses: { 204: { description: 'Stored' } } },
      delete: { summary: `xAPI 2.0 ${slug} resource (DELETE)`, tags: ['xapi-lrs'], responses: { 204: { description: 'Deleted' } } },
    };
  }

  // LTI 1.3 endpoints
  paths['/lti/.well-known/jwks.json'] = { get: { summary: 'Tool JWKS (LTI 1.3 / RFC 7517)', tags: ['lti'], responses: { 200: { description: 'JWK set with Tool public keys' } } } };
  paths['/lti/login'] = {
    get: { summary: 'OIDC 3rd-party-initiated login (LTI 1.3 §5.1.1)', tags: ['lti'], responses: { 302: { description: 'Redirect to platform auth endpoint' } } },
    post: { summary: 'OIDC 3rd-party-initiated login (POST form)', tags: ['lti'], responses: { 302: { description: 'Redirect to platform auth endpoint' } } },
  };
  paths['/lti/launch'] = { post: { summary: 'Resource-link launch (id_token verify + session creation)', tags: ['lti'], responses: { 302: { description: 'Redirect to Foxxi dashboard with launch ticket' } } } };
  paths['/lti/ags/scores'] = { post: { summary: 'Post a score back to the LMS (AGS 2.0)', tags: ['lti'], responses: { 200: { description: 'Score accepted upstream' } } } };
  paths['/lti/nrps/members'] = { get: { summary: 'Names & Roles Provisioning members (NRPS 2.0)', tags: ['lti'], responses: { 200: { description: 'Member roster' } } } };

  // OneRoster 1.2 endpoints
  paths['/ims/oneroster/v1p2/users'] = { get: { summary: 'OneRoster 1.2 users', tags: ['oneroster'], responses: { 200: { description: 'User list' } } } };
  paths['/ims/oneroster/v1p2/users/{sourcedId}'] = { get: { summary: 'OneRoster 1.2 user by sourcedId', tags: ['oneroster'], parameters: [{ name: 'sourcedId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'User' } } } };
  paths['/ims/oneroster/v1p2/orgs'] = { get: { summary: 'OneRoster 1.2 orgs', tags: ['oneroster'], responses: { 200: { description: 'Orgs list' } } } };
  paths['/ims/oneroster/v1p2/classes'] = { get: { summary: 'OneRoster 1.2 classes (audiences in Foxxi)', tags: ['oneroster'], responses: { 200: { description: 'Class list' } } } };
  paths['/ims/oneroster/v1p2/enrollments'] = { get: { summary: 'OneRoster 1.2 enrollments (assignments in Foxxi)', tags: ['oneroster'], responses: { 200: { description: 'Enrollment list' } } } };
  paths['/ims/oneroster/v1p2/import'] = { post: { summary: 'OneRoster 1.2 CSV bundle ingest', tags: ['oneroster'], responses: { 200: { description: 'Counts per CSV file' } } } };

  // Observability
  paths['/metrics'] = { get: { summary: 'Prometheus metrics', tags: ['ops'], responses: { 200: { description: 'Prometheus text format' } } } };
  paths['/metrics.json'] = { get: { summary: 'Structured JSON metrics', tags: ['ops'], responses: { 200: { description: 'JSON object' } } } };

  return {
    openapi: '3.1.0',
    info: {
      title: 'Foxxi Content Intelligence — bridge API',
      version: '1.0.0',
      description: `Enterprise-grade L&D vertical on the Interego substrate.

This API exposes:
- 50+ affordances over MCP JSON-RPC (the primary surface — see /mcp)
- A REST projection of each affordance at /tools/{affordance_name}
- An inbound xAPI 2.0 LRS (write external Statements into the substrate)
- An LTI 1.3 Advantage Tool Provider (launch from any LMS)
- A OneRoster 1.2 roster service (read + CSV-bundle ingest)
- Prometheus observability at /metrics

Standards conformance map at /CONFORMANCE.md (in the source repo).`,
      contact: { name: 'Foxxi', url: 'https://github.com/markjspivey-xwisee/interego' },
      license: { name: 'See repository LICENSE' },
    },
    servers: [{ url: config.selfBaseUrl, description: 'Live deployment' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'foxxi-session-token (ECDSA-signed; mint via dashboard)' },
        basicAuth: { type: 'http', scheme: 'basic', description: 'xAPI LRS Basic credentials (FOXXI_LRS_BASIC_AUTH_PAIRS)' },
      },
    },
    paths,
  };
}

export function attachOpenApiRoutes(app: Express, config: Config): void {
  app.get('/openapi.json', (_req: Request, res: Response) => {
    res.json(buildOpenApiDoc(config));
  });

  app.get('/docs', (_req: Request, res: Response) => {
    res.type('text/html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Foxxi bridge — OpenAPI docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <style>body{margin:0}#swagger-ui{max-width:1200px;margin:0 auto}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        presets: [SwaggerUIBundle.presets.apis],
        layout: 'BaseLayout',
        deepLinking: true,
      });
    };
  </script>
</body>
</html>`);
  });
}
