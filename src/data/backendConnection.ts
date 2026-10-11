import * as SecureStore from 'expo-secure-store';
export type BackendSettings = { enabled: boolean; serviceUrl: string; pairingToken: string };
const wifiBackendUrl = 'http://192.168.1.3:4319';
export const defaultBackendSettings: BackendSettings = { enabled: false, serviceUrl: wifiBackendUrl, pairingToken: '' };
const storageKey = 'jigyabyte.backend.connection.v1';
export function validateServiceUrl(value: string): string {
  const url = new URL(value.trim());
  const privateHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    || /^10\.\d+\.\d+\.\d+$/.test(url.hostname) || /^192\.168\.\d+\.\d+$/.test(url.hostname)
    || /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(url.hostname);
  if (!privateHost || !['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use a local PC backend address, such as http://192.168.1.10:4319.');
  }
  return url.origin;
}
export async function getBackendSettings(): Promise<BackendSettings> {
  const stored = await SecureStore.getItemAsync(storageKey);
  if (!stored) return defaultBackendSettings;
  try {
    const value = JSON.parse(stored);
    const serviceUrl = validateServiceUrl(value.serviceUrl);
    const settings = { enabled: value.enabled === true,
      serviceUrl: serviceUrl === 'http://127.0.0.1:4319' ? wifiBackendUrl : serviceUrl,
      pairingToken: typeof value.pairingToken === 'string' ? value.pairingToken : '' };
    if (settings.serviceUrl !== serviceUrl) await SecureStore.setItemAsync(storageKey, JSON.stringify(settings));
    return settings;
  }
  catch { return defaultBackendSettings; }
}
export async function saveBackendSettings(settings: BackendSettings): Promise<BackendSettings> {
  const normalized = { ...settings, serviceUrl: validateServiceUrl(settings.serviceUrl), pairingToken: settings.pairingToken.trim() };
  if (normalized.enabled && normalized.pairingToken.length < 32) throw new Error('Enter the backend pairing token from BACKEND_DEVICE_TOKEN.');
  await SecureStore.setItemAsync(storageKey, JSON.stringify(normalized));
  return normalized;
}
