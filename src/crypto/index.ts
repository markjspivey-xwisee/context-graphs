/**
 * @module crypto
 * @description Blockchain, IPFS, and wallet integration.
 *
 * IPFS: Content-addressed permanent storage for PGSL fragments
 * Wallets: Agent identity, descriptor signing, delegation proofs
 * ERC-8004: On-chain agent identity tokens
 * ERC-4361 (SIWE): Sign-In With Ethereum for human auth
 * X402: Agentic payments for premium context
 */

// Types
export type {
  CID,
  IpfsPinResult,
  IpfsAnchor,
  IpfsConfig,
  Wallet,
  WalletDelegation,
  SignedDescriptor,
  AgentIdentityToken,
  SiweMessage,
  SiweVerification,
  X402PaymentRequired,
  X402PaymentOption,
  X402PaymentReceipt,
  IdentityAnchors,
} from './types.js';

// IPFS
export {
  sha256,
  pinToIpfs,
  createIpfsAnchor,
  pinPgslFragment,
  pinDescriptor,
} from './ipfs.js';

// Wallets
export {
  createMockWallet,
  createMockDelegation,
  signDescriptor,
  verifyDescriptorSignature,
  createMockAgentToken,
  createSiweMessage,
  formatSiweMessage,
  verifySiweSignature,
  createAgentKitWallet,
} from './wallet.js';
