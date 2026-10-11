import * as SecureStore from 'expo-secure-store';
import { validateServiceUrl } from './cardGenerator';
export type BackendSettings = { enabled: boolean; serviceUrl: string; pairingToken: string };
export const defaultBackendSettings: BackendSettings = { enabled: false, serviceUrl: 'http://127.0.0.1:4319', pairingToken: '' };
const storageKey = 'jigyabyte.backend.connection.v1';
export async function getBackendSettings(): Promise<BackendSettings> {
  const stored = await SecureStore.getItemAsync(storageKey);
  if (!stored) return defaultBackendSettings;
  try { const value = JSON.parse(stored); return { enabled: value.enabled === true, serviceUrl: validateServiceUrl(value.serviceUrl), pairingToken: typeof value.pairingToken === 'string' ? value.pairingToken : '' }; }
  catch { return defaultBackendSettings; }
}
export async function saveBackendSettings(settings: BackendSettings): Promise<BackendSettings> {
  const normalized = { ...settings, serviceUrl: validateServiceUrl(settings.serviceUrl), pairingToken: settings.pairingToken.trim() };
  if (normalized.enabled && normalized.pairingToken.length < 32) throw new Error('Enter the backend pairing token from BACKEND_DEVICE_TOKEN.');
  await SecureStore.setItemAsync(storageKey, JSON.stringify(normalized));
  return normalized;
}
