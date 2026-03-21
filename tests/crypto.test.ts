import { describe, it, expect } from 'vitest';
import {
  sha256,
  pinToIpfs,
  createIpfsAnchor,
  pinPgslFragment,
  pinDescriptor,
  createMockWallet,
  createMockDelegation,
  signDescriptor,
  verifyDescriptorSignature,
  createMockAgentToken,
  createSiweMessage,
  formatSiweMessage,
  verifySiweSignature,
  ContextDescriptor,
  toTurtle,
} from '../src/index.js';
import type { IRI, IpfsConfig } from '../src/index.js';

const mockIpfsConfig: IpfsConfig = { provider: 'mock' };

// ═════════════════════════════════════════════════════════════
//  SHA-256 Hashing
// ═════════════════════════════════════════════════════════════

describe('SHA-256', () => {
  it('produces deterministic hashes', async () => {
    const a = await sha256('hello');
    const b = await sha256('hello');
    expect(a).toBe(b);
  });

  it('different content produces different hashes', async () => {
    const a = await sha256('hello');
    const b = await sha256('world');
    expect(a).not.toBe(b);
  });
});

// ═════════════════════════════════════════════════════════════
//  IPFS Pinning
// ═════════════════════════════════════════════════════════════

describe('IPFS Pinning', () => {
  it('mock pins content and returns CID', async () => {
    const result = await pinToIpfs('test content', 'test.txt', mockIpfsConfig);
    expect(result.cid).toBeTruthy();
    expect(result.cid.startsWith('bafymock')).toBe(true);
    expect(result.provider).toBe('mock');
    expect(result.url).toContain('ipfs://');
  });

  it('deterministic CID for same content', async () => {
    const a = await pinToIpfs('same content', 'a.txt', mockIpfsConfig);
    const b = await pinToIpfs('same content', 'b.txt', mockIpfsConfig);
    expect(a.cid).toBe(b.cid);
  });

  it('creates IPFS anchor from pin result', async () => {
    const pin = await pinToIpfs('anchor content', 'anchor.txt', mockIpfsConfig);
    const anchor = await createIpfsAnchor('anchor content', pin);
    expect(anchor.cid).toBe(pin.cid);
    expect(anchor.contentHash).toBeTruthy();
    expect(anchor.pinnedAt).toBeTruthy();
  });

  it('pins PGSL fragment', async () => {
    const anchor = await pinPgslFragment(
      'urn:pgsl:fragment:L2:test' as IRI,
      'fragment content',
      mockIpfsConfig,
    );
    expect(anchor.cid).toBeTruthy();
    expect(anchor.gatewayUrl).toContain('ipfs://');
  });

  it('pins descriptor Turtle', async () => {
    const desc = ContextDescriptor.create('urn:cg:test:pin' as IRI)
      .describes('urn:graph:test' as IRI)
      .temporal({ validFrom: '2026-01-01T00:00:00Z' })
      .asserted(0.9)
      .selfAsserted('did:web:test' as IRI)
      .version(1)
      .build();

    const turtle = toTurtle(desc);
    const anchor = await pinDescriptor(desc.id, turtle, mockIpfsConfig);
    expect(anchor.cid).toBeTruthy();
    expect(anchor.contentHash).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════
//  Wallets
// ═════════════════════════════════════════════════════════════

describe('Mock Wallets', () => {
  it('creates human wallet', async () => {
    const wallet = await createMockWallet('human', 'Mark');
    expect(wallet.address.startsWith('0x')).toBe(true);
    expect(wallet.address.length).toBe(42);
    expect(wallet.type).toBe('human');
    expect(wallet.provider).toBe('mock');
  });

  it('creates agent wallet', async () => {
    const wallet = await createMockWallet('agent', 'Claude Code');
    expect(wallet.type).toBe('agent');
    expect(wallet.chainId).toBe(84532); // Base Sepolia
  });

  it('different labels produce different addresses', async () => {
    const a = await createMockWallet('agent', 'Alice');
    const b = await createMockWallet('agent', 'Bob');
    expect(a.address).not.toBe(b.address);
  });
});

describe('Wallet Delegation', () => {
  it('creates delegation from owner to agent', async () => {
    const owner = await createMockWallet('human', 'Mark');
    const agent = await createMockWallet('agent', 'Claude');

    const delegation = await createMockDelegation(owner, agent, 'ReadWrite');
    expect(delegation.ownerAddress).toBe(owner.address);
    expect(delegation.agentAddress).toBe(agent.address);
    expect(delegation.scope).toBe('ReadWrite');
    expect(delegation.signature.startsWith('0x')).toBe(true);
    expect(delegation.chainId).toBe(owner.chainId);
  });
});

// ═════════════════════════════════════════════════════════════
//  Descriptor Signing
// ═════════════════════════════════════════════════════════════

describe('Descriptor Signing', () => {
  it('signs and verifies a descriptor', async () => {
    const agent = await createMockWallet('agent', 'Signer');
    const turtle = '@prefix cg: <urn:cg:> . cg:test cg:value "hello" .';

    const signed = await signDescriptor('urn:cg:test:signed' as IRI, turtle, agent);
    expect(signed.signature.startsWith('0x')).toBe(true);
    expect(signed.signerAddress).toBe(agent.address);
    expect(signed.contentHash).toBeTruthy();

    const verification = await verifyDescriptorSignature(signed, turtle);
    expect(verification.valid).toBe(true);
  });

  it('rejects tampered content', async () => {
    const agent = await createMockWallet('agent', 'Signer2');
    const turtle = '@prefix cg: <urn:cg:> . cg:test cg:value "original" .';

    const signed = await signDescriptor('urn:cg:test:tampered' as IRI, turtle, agent);

    const tampered = '@prefix cg: <urn:cg:> . cg:test cg:value "MODIFIED" .';
    const verification = await verifyDescriptorSignature(signed, tampered);
    expect(verification.valid).toBe(false);
    expect(verification.reason).toContain('mismatch');
  });
});

// ═════════════════════════════════════════════════════════════
//  ERC-8004 Agent Identity Token
// ═════════════════════════════════════════════════════════════

describe('ERC-8004 Agent Identity', () => {
  it('creates mock agent identity token', async () => {
    const owner = await createMockWallet('human', 'TokenOwner');
    const agent = await createMockWallet('agent', 'TokenAgent');

    const token = await createMockAgentToken(owner, agent, 'urn:agent:test:token' as IRI, {
      name: 'Test Agent',
      description: 'A test agent',
      capabilities: ['discover', 'publish', 'compose'],
      delegationScope: 'ReadWrite',
    });

    expect(token.tokenId).toBeTruthy();
    expect(token.ownerAddress).toBe(owner.address);
    expect(token.agentAddress).toBe(agent.address);
    expect(token.agentUri).toBe('urn:agent:test:token');
    expect(token.metadata.capabilities).toContain('publish');
    expect(token.transactionHash?.startsWith('0x')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════
//  ERC-4361 SIWE
// ═════════════════════════════════════════════════════════════

describe('SIWE (Sign-In With Ethereum)', () => {
  it('creates SIWE message', () => {
    const msg = createSiweMessage(
      'context-graphs.example.com',
      '0x1234567890abcdef1234567890abcdef12345678',
      'Sign in to Context Graphs',
      'https://context-graphs.example.com',
      1,
      ['https://pod.example.com/markj/'],
    );

    expect(msg.domain).toBe('context-graphs.example.com');
    expect(msg.version).toBe('1');
    expect(msg.nonce).toBeTruthy();
    expect(msg.resources).toContain('https://pod.example.com/markj/');
  });

  it('formats SIWE message as ERC-4361 string', () => {
    const msg = createSiweMessage(
      'app.example.com',
      '0xabcdef1234567890abcdef1234567890abcdef12',
      'Authenticate to publish context',
      'https://app.example.com',
    );

    const formatted = formatSiweMessage(msg);
    expect(formatted).toContain('app.example.com wants you to sign in');
    expect(formatted).toContain('0xabcdef');
    expect(formatted).toContain('Authenticate to publish context');
    expect(formatted).toContain('Nonce:');
  });

  it('verifies SIWE signature (mock)', async () => {
    const msg = createSiweMessage(
      'test.com',
      '0x1111111111111111111111111111111111111111',
      'Test sign in',
      'https://test.com',
    );

    const result = await verifySiweSignature(msg, '0xmocksignature1234567890');
    expect(result.valid).toBe(true);
    expect(result.address).toBe('0x1111111111111111111111111111111111111111');
  });

  it('rejects expired SIWE message', async () => {
    const msg = createSiweMessage(
      'test.com',
      '0x2222222222222222222222222222222222222222',
      'Expired',
      'https://test.com',
    );

    const expired = { ...msg, expirationTime: '2020-01-01T00:00:00Z' };
    const result = await verifySiweSignature(expired, '0xmocksignature1234567890');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('expired');
  });
});
