// Create preview + intake status route logic (plan M08-04, G04/G23/G30/G40).
// Preview must match factory prediction exactly. Unknown platform tokens get
// an intake-needed result, never a deployable claim or a wallet-launch ask.
import { envelope, validateAddress, validateAmount, ValidationError } from './api-schema.mjs';

export function validateCreateRequest({ chainId, baseAsset, quoteAsset, class: poolClass, initialPriceRaw, seedMaxRaw, capsRaw }) {
  validateAddress(baseAsset, 'baseAsset');
  validateAddress(quoteAsset, 'quoteAsset');
  if (poolClass !== 'PRICE_GUARDED' && poolClass !== 'SESSION_ONLY') {
    throw new ValidationError('class', 'must be PRICE_GUARDED or SESSION_ONLY');
  }
  validateAmount(initialPriceRaw, 'initialPriceRaw');
  validateAmount(seedMaxRaw, 'seedMaxRaw');
  if (capsRaw !== undefined && typeof capsRaw !== 'object') throw new ValidationError('capsRaw', 'must be an object');
  if (baseAsset.toLowerCase() === quoteAsset.toLowerCase()) {
    throw new ValidationError('assets', 'base and quote must differ');
  }
  return { chainId, baseAsset, quoteAsset, class: poolClass, initialPriceRaw, seedMaxRaw, capsRaw: capsRaw ?? {} };
}

export function createPreview({ chainId, request, registry, observedBlockNumber, observedBlockHash, observedAt, requestId }) {
  const baseKnown = registry.hasDescriptor(request.baseAsset.toLowerCase());
  const quoteKnown = registry.hasDescriptor(request.quoteAsset.toLowerCase());

  if (!baseKnown || !quoteKnown) {
    return envelope({
      chainId, observedBlockNumber, observedBlockHash, observedAt, requestId,
      status: 'INTAKE_NEEDED',
      extra: {
        intake: {
          unknownAssets: [
            ...(!baseKnown ? [request.baseAsset] : []),
            ...(!quoteKnown ? [request.quoteAsset] : []),
          ],
          message: 'Token is not registered as a canonical descriptor. An official preview requires intake and governance review; it does not imply an immediate deployment.',
        },
        preview: null,
      },
    });
  }

  const baseCaps = registry.capabilities(request.baseAsset.toLowerCase());
  const eligible =
    (request.class === 'PRICE_GUARDED' && baseCaps.independentPriceSource && registry.capabilities(request.quoteAsset.toLowerCase()).independentPriceSource) ||
    (request.class === 'SESSION_ONLY' && baseCaps.canonicalStock);

  if (!eligible) {
    return envelope({
      chainId, observedBlockNumber, observedBlockHash, observedAt, requestId,
      status: 'NOT_ADMITTED',
      extra: {
        reason: request.class === 'PRICE_GUARDED'
          ? 'Both assets require approved independent price sources.'
          : 'A canonical stock asset is required for SESSION_ONLY.',
        preview: null,
      },
    });
  }

  return envelope({
    chainId, observedBlockNumber, observedBlockHash, observedAt, requestId,
    extra: {
      preview: {
        class: request.class,
        predictedHookAddress: registry.predictedHook({ configHash: registry.configHashFor(request) }),
        predictedPoolId: registry.predictedPoolId({ configHash: registry.configHashFor(request) }),
        requestHash: registry.requestHashFor(request),
        serviceFeeUsdg: '49000000',
        seedMaxRaw: request.seedMaxRaw,
        capsRaw: request.capsRaw,
        disclosures: [
          request.class === 'SESSION_ONLY'
            ? 'SESSION_ONLY does not guarantee a fair price for the counterasset.'
            : 'PRICE_GUARDED displays a band against a reference with provenance.',
        ],
      },
    },
  });
}
