/** Resolve deployment-specific keeper settings without silently targeting an old stack. */
export function resolveSessionRegistry(env, manifest) {
  const address = env.BELL_SESSION_REGISTRY || manifest?.sessionRegistry;
  if (!address) throw new Error('SessionRegistry is missing from both BELL_SESSION_REGISTRY and deployment manifest');
  return address;
}
