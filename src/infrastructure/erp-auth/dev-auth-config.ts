export function isDevErpAuthEnabled() {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }

  return process.env.ENABLE_DEV_ERP_AUTH === '1';
}
