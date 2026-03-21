/**
 * @module crypto/wallet
 * @description Wallet operations for agent identity and descriptor signing.
 *
 * Supports:
 *   - Mock wallets (testing, no blockchain needed)
 *   - Coinbase AgentKit (when @coinbase/agentkit is available)
 *   - External wallets (MetaMask, etc. via message signing)
 *
 * The wallet model:
 *   Human (external wallet) → delegates to → Agent (AgentKit MPC wallet)
 *   Agent wallet signs descriptors → cryptographic proof of authorship
 *   Delegation is an EIP-712 typed signature from the human wallet
 */

import type { IRI } from '../model/types.js';
import type {
  Wallet,
  WalletDelegation,
  SignedDescriptor,
  AgentIdentityToken,
  SiweMessage,
  SiweVerification,
} from './types.js';
import { sha256 } from './ipfs.js';

// ═════════════════════════════════════════════════════════════
//  Mock Wallet (for testing without blockchain)
// ═════════════════════════════════════════════════════════════

let mockWalletCounter = 0;

/**
 * Create a mock wallet for testing.
 * Generates a deterministic address from the label.
 */
export async function createMockWallet(
  type: 'human' | 'agent',
  label: string,
): Promise<Wallet> {
  const hash = await sha256(`${label}-${mockWalletCounter++}`);
  return {
    address: `0x${hash.slice(0, 40)}`,
    type,
    provider: 'mock',
    chainId: 84532, // Base Sepolia testnet
    label,
  };
}

/**
 * Create a mock delegation: human wallet authorizes agent wallet.
 * In production, this would be an EIP-712 typed signature.
 */
export async function createMockDelegation(
  ownerWallet: Wallet,
  agentWallet: Wallet,
  scope: string = 'ReadWrite',
  validUntil?: string,
): Promise<WalletDelegation> {
  const message = JSON.stringify({
    type: 'ContextGraphsDelegation',
    owner: ownerWallet.address,
    agent: agentWallet.address,
    scope,
    chainId: ownerWallet.chainId,
    issuedAt: new Date().toISOString(),
    validUntil,
  });

  const signature = await sha256(`sig:${ownerWallet.address}:${message}`);

  return {
    ownerAddress: ownerWallet.address,
    agentAddress: agentWallet.address,
    scope,
    signature: `0x${signature}`,
    message,
    chainId: ownerWallet.chainId,
    validUntil,
  };
}

/**
 * Sign a descriptor with the agent wallet.
 * In production, this would use ECDSA over secp256k1.
 */
export async function signDescriptor(
  descriptorId: IRI,
  turtle: string,
  agentWallet: Wallet,
): Promise<SignedDescriptor> {
  const contentHash = await sha256(turtle);
  const signatureInput = `${agentWallet.address}:${contentHash}:${descriptorId}`;
  const signature = await sha256(`ecdsa:${signatureInput}`);

  return {
    descriptorId,
    contentHash,
    signature: `0x${signature}`,
    signerAddress: agentWallet.address,
    signedAt: new Date().toISOString(),
    chainId: agentWallet.chainId,
  };
}

/**
 * Verify a descriptor signature.
 * In production, this would recover the signer address from the ECDSA signature.
 */
export async function verifyDescriptorSignature(
  signed: SignedDescriptor,
  turtle: string,
): Promise<{ valid: boolean; reason?: string }> {
  const contentHash = await sha256(turtle);
  if (contentHash !== signed.contentHash) {
    return { valid: false, reason: 'Content hash mismatch — descriptor was modified after signing' };
  }

  // In mock mode, re-derive the expected signature
  const signatureInput = `${signed.signerAddress}:${contentHash}:${signed.descriptorId}`;
  const expectedSignature = `0x${await sha256(`ecdsa:${signatureInput}`)}`;

  if (signed.signature !== expectedSignature) {
    return { valid: false, reason: 'Signature verification failed' };
  }

  return { valid: true };
}

// ═════════════════════════════════════════════════════════════
//  ERC-8004: Agent Identity Token
// ═════════════════════════════════════════════════════════════

/**
 * Create a mock ERC-8004 agent identity token.
 * In production, this would mint an NFT on-chain.
 */
export async function createMockAgentToken(
  ownerWallet: Wallet,
  agentWallet: Wallet,
  agentUri: IRI,
  metadata: { name: string; description: string; capabilities: string[]; delegationScope: string },
): Promise<AgentIdentityToken> {
  const tokenId = await sha256(`erc8004:${agentWallet.address}:${Date.now()}`);
  const txHash = await sha256(`tx:${tokenId}`);

  return {
    tokenId: tokenId.slice(0, 16),
    contractAddress: '0x8004000000000000000000000000000000000000', // placeholder
    chainId: ownerWallet.chainId,
    ownerAddress: ownerWallet.address,
    agentAddress: agentWallet.address,
    agentUri,
    metadata,
    mintedAt: new Date().toISOString(),
    transactionHash: `0x${txHash}`,
  };
}

// ═════════════════════════════════════════════════════════════
//  ERC-4361: Sign-In With Ethereum (SIWE)
// ═════════════════════════════════════════════════════════════

/**
 * Create a SIWE message for human authentication.
 */
export function createSiweMessage(
  domain: string,
  address: string,
  statement: string,
  uri: string,
  chainId: number = 1,
  resources?: string[],
): SiweMessage {
  return {
    domain,
    address,
    statement,
    uri,
    version: '1',
    chainId,
    nonce: Math.random().toString(36).slice(2, 14),
    issuedAt: new Date().toISOString(),
    resources,
  };
}

/**
 * Format a SIWE message as the ERC-4361 string.
 */
export function formatSiweMessage(msg: SiweMessage): string {
  const lines = [
    `${msg.domain} wants you to sign in with your Ethereum account:`,
    msg.address,
    '',
    msg.statement,
    '',
    `URI: ${msg.uri}`,
    `Version: ${msg.version}`,
    `Chain ID: ${msg.chainId}`,
    `Nonce: ${msg.nonce}`,
    `Issued At: ${msg.issuedAt}`,
  ];
  if (msg.expirationTime) lines.push(`Expiration Time: ${msg.expirationTime}`);
  if (msg.resources?.length) {
    lines.push('Resources:');
    for (const r of msg.resources) lines.push(`- ${r}`);
  }
  return lines.join('\n');
}

/**
 * Verify a SIWE signature (mock implementation).
 * In production, use siwe.js or ethers.js to recover the signer.
 */
export async function verifySiweSignature(
  message: SiweMessage,
  signature: string,
): Promise<SiweVerification> {
  // Mock: accept any signature that's the right length
  if (!signature || signature.length < 10) {
    return { valid: false, error: 'Invalid signature format' };
  }

  // Check expiration
  if (message.expirationTime && new Date(message.expirationTime) < new Date()) {
    return { valid: false, error: 'SIWE message expired' };
  }

  return {
    valid: true,
    address: message.address,
    chainId: message.chainId,
  };
}

// ═════════════════════════════════════════════════════════════
//  Coinbase AgentKit Integration
// ═════════════════════════════════════════════════════════════

/**
 * Create an agent wallet via Coinbase AgentKit.
 * Falls back to mock if AgentKit is not installed.
 */
export async function createAgentKitWallet(
  label: string,
  _chainId: number = 84532,
): Promise<Wallet> {
  // Try to load AgentKit dynamically
  try {
    // Dynamic import — @coinbase/agentkit is optional
    const moduleName = '@coinbase/agentkit';
    const agentkit = await import(moduleName) as any;
    if (agentkit && typeof agentkit.AgentKit?.from === 'function') {
      const kit = await agentkit.AgentKit.from({
        cdpApiKeyName: process.env['CDP_API_KEY_NAME'],
        cdpApiKeyPrivate: process.env['CDP_API_KEY_PRIVATE'],
      });
      const walletData = await kit.exportWallet();
      return {
        address: walletData.defaultAddressId ?? `0x${await sha256(label + Date.now())}`.slice(0, 42),
        type: 'agent',
        provider: 'agentkit',
        chainId: _chainId,
        label,
      };
    }
  } catch {
    // AgentKit not available, fall through to mock
  }

  // Fallback to mock
  return createMockWallet('agent', label);
}
