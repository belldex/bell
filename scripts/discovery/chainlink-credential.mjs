const MAINNET_HOST = 'api.dataengine.chain.link';
const TESTNET_HOST = 'api.testnet-dataengine.chain.link';

export function selectChainlinkCredential(env, endpoint) {
  let hostname;
  try {
    hostname = new URL(endpoint).hostname.toLowerCase();
  } catch {
    throw new TypeError('Chainlink Data Streams endpoint must be a valid URL');
  }

  let credential;
  let network;
  if (hostname === TESTNET_HOST) {
    credential = env?.CHAINLINK_TESTNET_SOURCE_CREDENTIAL;
    network = 'testnet';
    if (!credential) throw new Error('CHAINLINK_TESTNET_SOURCE_CREDENTIAL is required; mainnet credentials are not reused for Testnet');
  } else if (hostname === MAINNET_HOST) {
    credential = env?.CHAINLINK_SOURCE_CREDENTIAL_A;
    network = 'mainnet';
    if (!credential) throw new Error('CHAINLINK_SOURCE_CREDENTIAL_A is required for the mainnet endpoint');
  } else {
    throw new Error('Chainlink Data Streams endpoint host is not an approved mainnet or testnet host');
  }

  const separator = credential.indexOf(':');
  if (separator <= 0 || separator === credential.length - 1) {
    throw new Error(`Credential for ${network} must be <username>:<secret>`);
  }
  return Object.freeze({
    username: credential.slice(0, separator),
    secret: credential.slice(separator + 1),
    network,
  });
}
