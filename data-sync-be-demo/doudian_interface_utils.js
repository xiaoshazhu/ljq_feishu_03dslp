const DOUDIAN_INTERFACE_PREFIX = 'doudian_shop__';

function isDoudianInterfaceModule(module) {
  return typeof module === 'string' && module.startsWith(DOUDIAN_INTERFACE_PREFIX);
}

function getInterfaceKeyFromModule(module) {
  if (!isDoudianInterfaceModule(module)) return '';
  return module.slice(DOUDIAN_INTERFACE_PREFIX.length);
}

function toDoudianInterfaceModule(interfaceKey) {
  return DOUDIAN_INTERFACE_PREFIX + interfaceKey;
}

module.exports = {
  DOUDIAN_INTERFACE_PREFIX,
  isDoudianInterfaceModule,
  getInterfaceKeyFromModule,
  toDoudianInterfaceModule
};
