/**
 * Protocol Adapter - Direct Bridge to Codex's @bell/protocol and @bell/domain
 * 
 * This file connects the Next.js frontend with Codex's generated ABIs,
 * domain math, and binary encoders.
 */

import abiManifest from '../../../packages/protocol/generated/abi-manifest.json';
// @ts-expect-error Workspace package export
import { encodeSwapRequest, SWAP_REQUEST_COMPONENTS } from '@bell/protocol/swap-codec';
// @ts-expect-error Workspace package export
import { encodeCreateRequest, POOL_CONFIG_COMPONENTS, CREATE_REQUEST_COMPONENTS } from '@bell/protocol/create-codec';
// @ts-expect-error Workspace package export
import { bellFee, effectiveLpFee } from '@bell/domain/fee-policy';
// @ts-expect-error Workspace package export
import { ClosureBudget } from '@bell/domain/closure-budget';
import { readTestnetStatus, TESTNET, isUnusableRole, type TestnetStatus } from '@bell/protocol/testnet-status';

export interface ProtocolAbiManifest {
  schemaVersion: number;
  compilerVersion: string;
  abiSha256: string;
  interfaces: {
    IAssetRegistry: unknown[];
    IBellErrors: unknown[];
    IBellEvents: unknown[];
    IBellHook: unknown[];
    IBellPoolFactory: unknown[];
    IBellRouter: unknown[];
    ICalendarRegistry: unknown[];
    ISafetyController: unknown[];
    ISessionRegistry: unknown[];
    ISourceAdapterIdentity: unknown[];
    ITreasuryAdapter: unknown[];
  };
}

export const ABI = (abiManifest as ProtocolAbiManifest).interfaces;

export {
  encodeSwapRequest,
  SWAP_REQUEST_COMPONENTS,
  encodeCreateRequest,
  POOL_CONFIG_COMPONENTS,
  CREATE_REQUEST_COMPONENTS,
  bellFee,
  effectiveLpFee,
  ClosureBudget,
  readTestnetStatus,
  TESTNET,
  isUnusableRole,
  type TestnetStatus,
};
