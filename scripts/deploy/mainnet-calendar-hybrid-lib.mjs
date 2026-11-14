import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, parseAbiParameters } from 'viem';

export const GOVERNANCE_ROLE = keccak256(new TextEncoder().encode('GOVERNANCE'));
export const QUEUE_GOVERNANCE_CALL_ACTION = keccak256(new TextEncoder().encode('SAFETY_QUEUE_GOVERNANCE_CALL'));

const CALENDAR_ABI = parseAbi([
  'function queueRoot(bytes32 assetId,(bytes32 root,uint32 leafCount,uint64 coverageStart,uint64 coverageEnd,uint64 queuedAt,uint64 executableAt,bytes32 datasetHash) metadata) returns (bytes32 operationId)',
]);
const PAYLOAD_ABI = parseAbiParameters('address target, bytes32 callDataHash');

/** Encode the exact CalendarRegistry call and SafetyControllerV2 signed payload. */
export function buildCalendarRootGovernanceCall({ calendarRegistry, assetId, metadata }) {
  const callData = encodeFunctionData({
    abi: CALENDAR_ABI,
    functionName: 'queueRoot',
    args: [assetId, {
      root: metadata.root,
      leafCount: Number(metadata.leafCount),
      coverageStart: BigInt(metadata.coverageStart),
      coverageEnd: BigInt(metadata.coverageEnd),
      queuedAt: 0n,
      executableAt: 0n,
      datasetHash: metadata.datasetHash,
    }],
  });
  const payloadHash = keccak256(encodeAbiParameters(PAYLOAD_ABI, [calendarRegistry, keccak256(callData)]));
  return Object.freeze({
    target: calendarRegistry,
    callData,
    payloadHash,
    action: QUEUE_GOVERNANCE_CALL_ACTION,
    role: GOVERNANCE_ROLE,
  });
}
