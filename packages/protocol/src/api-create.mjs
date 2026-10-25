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
          message: 'Token belum terdaftar sebagai canonical descriptor. Preview resmi butuh intake dan review governance, bukan klaim deploy sekarang.',
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
          ? 'kedua aset membutuhkan sumber harga independen yang disetujui'
          : 'aset stock canonical dibutuhkan untuk SESSION_ONLY',
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
            ? 'SESSION_ONLY tidak menjamin harga wajar counterasset.'
            : 'PRICE_GUARDED menampilkan band terhadap reference dengan provenance.',
        ],
      },
    },
  });
}