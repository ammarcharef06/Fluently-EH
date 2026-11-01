import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'jsdom', include: ['packages/**/*.test.ts', 'services/**/*.test.ts'], clearMocks: true, restoreMocks: true } });
