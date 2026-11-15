// Only for the manual `vite dev` check of HMR and Fast Refresh (see the README
// of the repository); the integration test passes its config inline.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { buildConditions } from '../../src/index.ts';

export default defineConfig({
    plugins: [
        buildConditions({
            groups: { platform: ['desktop', 'mobile'], runtime: ['server', 'client'] },
            conditions: { platform: 'desktop', runtime: 'client' },
        }),
        react(),
    ],
});
