import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'jsdom', include: ['apps/web/**/*.test.tsx', 'apps/admin/**/*.test.tsx', 'packages/**/*.test.ts', 'services/**/*.test.ts'], clearMocks: true, restoreMocks: true } });
