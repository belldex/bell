const requiredMethods = {
  clock: ['nowSeconds'],
  secrets: ['get'],
  storage: ['get', 'put'],
  logger: ['info', 'warn', 'error'],
  rpc: ['call'],
};

function requireMethodGroup(ports, group, methods) {
  if (!ports[group] || typeof ports[group] !== 'object') {
    throw new TypeError(`Missing runtime port: ${group}`);
  }
  for (const method of methods) {
    if (typeof ports[group][method] !== 'function') {
      throw new TypeError(`Runtime port ${group}.${method} must be a function`);
    }
  }
}

export function createRuntimePorts(ports) {
  if (!ports || typeof ports !== 'object') throw new TypeError('Runtime ports must be an object');
  for (const [group, methods] of Object.entries(requiredMethods)) {
    requireMethodGroup(ports, group, methods);
  }
  if (typeof ports.fetch !== 'function') throw new TypeError('Missing runtime port: fetch');

  const clock = Object.freeze({
    nowSeconds() {
      const value = ports.clock.nowSeconds();
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError('clock timestamp must be a non-negative safe integer in seconds');
      }
      return value;
    },
  });

  return Object.freeze({
    clock,
    fetch: ports.fetch,
    secrets: ports.secrets,
    storage: ports.storage,
    logger: ports.logger,
    rpc: ports.rpc,
  });
}
