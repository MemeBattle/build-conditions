# @memebattle/build-conditions-vite

The Vite plugin of [`@memebattle/build-conditions`](https://www.npmjs.com/package/@memebattle/build-conditions):
it inlines the matching condition branch and removes the dead ones together
with their imports, in both `vite build` and `vite dev`.

```bash
pnpm add -D @memebattle/build-conditions-vite
```

```typescript
// vite.config.ts
import { buildConditions } from '@memebattle/build-conditions-vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [
        buildConditions({
            groups: { platform: ['desktop', 'mobile'], runtime: ['server', 'client'] },
            conditions: { platform: 'desktop', runtime: 'client' },
        }),
        react(),
    ],
});
```

See the [repository README](https://github.com/MemeBattle/build-conditions#readme) for the full documentation.
