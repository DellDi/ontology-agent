export function isDevErpAuthEnabled() {
  return process.env.ENABLE_DEV_ERP_AUTH === '1';
}
