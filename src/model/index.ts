export * from './types.js';
export { ContextDescriptor } from './descriptor.js';
export {
  union,
  intersection,
  restriction,
  override,
  effectiveContext,
  resetComposedIdCounter,
} from './composition.js';
export {
  createOwnerProfile,
  addAuthorizedAgent,
  removeAuthorizedAgent,
  createDelegationCredential,
  ownerProfileToTurtle,
  parseOwnerProfile,
  delegationCredentialToJsonLd,
  verifyDelegation,
} from './delegation.js';
export {
  registerFacetType,
  getFacetEntry,
  getRegisteredTypes,
  executeMerge,
} from './registry.js';
export type { MergeStrategy, FacetRegistryEntry } from './registry.js';
