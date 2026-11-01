import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.fluently.app',
  appName: 'Fluently',
  webDir: '../../web/dist',
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false, captureInput: true }
};
export default config;
