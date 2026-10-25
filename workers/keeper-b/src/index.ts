import { parseUnits } from '@bell/domain/amounts';
import { bellFee } from '@bell/domain/fee-policy';
import vector from '@bell/test-vectors/runtime-compat';
import { hashCalendarLeaf } from '@bell/protocol/calendar';
import { canonicalTokenId } from '@bell/protocol/identity';
import { encodeSourceWires } from '@bell/protocol/source-codec';
import { encodeSwapRequest } from '@bell/protocol/swap-codec';
import { KeeperState } from './keeper-state.mjs';

export { KeeperState };

interface Env {
  BELL_TEST_MODE?: string;
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (env.BELL_TEST_MODE === '1' && url.pathname === '/__test/runtime') {
      return Response.json({
        fee: bellFee(vector.fee.baseSessionFee, vector.fee.bellElapsedSeconds),
        rawAmount: parseUnits(vector.amount.display, vector.amount.decimals).toString(),
        calendarLeafHash: hashCalendarLeaf({
          ...vector.calendarLeaf,
          chainId: BigInt(vector.calendarLeaf.chainId),
          start: BigInt(vector.calendarLeaf.start),
          end: BigInt(vector.calendarLeaf.end),
        }),
        canonicalTokenId: canonicalTokenId(BigInt(vector.canonicalToken.chainId), vector.canonicalToken.address),
        sourceWireEncoded: encodeSourceWires([vector.sourceWire]),
        swapRequestEncoded: encodeSwapRequest(vector.swapRequest),
      });
    }
    return new Response('Not found', { status: 404 });
  },
};

export default worker;
