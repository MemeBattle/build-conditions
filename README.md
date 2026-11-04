# build-conditions

Build-time code splitting by arbitrary conditions. You declare extensible
**condition groups** (`platform`, `runtime`, build A/B experiments, and so on),
branch your code with two tiny helpers, and get per-condition bundles: an SWC
plugin inlines the matching branch and removes the dead ones together with
their imports. Without the plugin the same code keeps working at runtime, so
tests, Storybook and dev setups need no special build.

- **Type-safe** — condition values are checked by TypeScript; mixing groups or
  misspelling a value is a compile-time error.
- **Runtime fallback** — every helper has a runtime implementation; the SWC
  plugin is an optimization, not a requirement.
- **Whole-branch elimination** — dead branches disappear from the bundle along
  with the imports only they used.

## Declaring condition groups

Groups are declared via declaration merging. Condition values must be unique
across all groups — a value is resolved to its group by the value itself:

```typescript
declare module 'build-conditions' {
    interface BuildConditionGroups {
        platform: 'desktop' | 'mobile';
        runtime: 'server' | 'client';
    }
}
```

## Usage

### `switchBuildCondition` — pick a value per condition

Branches are functions or objects (e.g. React components or CSS Modules).
The optional `default` branch is used when no key matches:

```typescript
import { switchBuildCondition } from 'build-conditions';
import DesktopComponent from './Component@desktop';
import MobileComponent from './Component@mobile';

export const Component = switchBuildCondition({
    desktop: DesktopComponent,
    mobile: MobileComponent,
});
```

### `isBuildConditions` — check active conditions

A single condition or an array (all must be active at once). The group name is
never spelled out — it is derived from the value:

```typescript
import { isBuildConditions } from 'build-conditions';

if (isBuildConditions(['desktop', 'client'])) {
    // code for the desktop client bundle only
}
```

Without the SWC plugin both helpers work at runtime: `switchBuildCondition`
returns a wrapper (an HOC for functions, a Proxy for objects) that resolves
the branch on every access, and `isBuildConditions` reads the current
conditions from the storage.

## Conditions storage (runtime mode)

The current conditions are read from a replaceable storage
(`getBuildConditions` throws when conditions are not set):

- **Browser, tests, Storybook** — the default storage backed by
  `globalThis.__BUILD_CONDITIONS__`; set conditions via
  `setBuildConditions({ platform: 'desktop' })`.
- **Server (SSR)** — the package does not pull in `node:async_hooks`: the
  service registers a storage backed by its own `AsyncLocalStorage` and sets
  conditions per request:

```typescript
import { AsyncLocalStorage } from 'node:async_hooks';
import { setBuildConditionsStorage, type PartialBuildConditions } from 'build-conditions';

const als = new AsyncLocalStorage<PartialBuildConditions>();

// once at server startup; `set` is omitted — setBuildConditions on the
// server throws, conditions are set only through als.run
setBuildConditionsStorage({ get: () => als.getStore() });

// in the request handler
als.run({ platform: detectPlatform(req), runtime: 'server' }, () => {
    const html = renderToString(<App />);
    res.send(html);
});
```

## SWC plugin

The `build-conditions/swc-plugin` entrypoint is a WASM plugin (`swc-plugin/`,
Rust, built against `swc_core` 79 — compatible with rspack 2.x; the
`swc_ast_unknown` cfg keeps it working with newer swc_core runners). The configuration lists the complete composition of the
groups plus the chosen value of each group — or `null` when the group is
switched at runtime and must not be transformed:

```json
{
    "groups": {
        "platform": ["desktop", "mobile"],
        "runtime": ["server", "client"]
    },
    "conditions": {
        "platform": "desktop",
        "runtime": "client"
    }
}
```

Wiring it up (e.g. in an swc/rspack config, one build per set of conditions):

```javascript
{
    jsc: {
        experimental: {
            plugins: [
                [
                    require.resolve('build-conditions/swc-plugin'),
                    {
                        groups: { platform: ['desktop', 'mobile'], runtime: ['server', 'client'] },
                        conditions: { platform: 'desktop', runtime: 'client' },
                    },
                ],
            ],
        },
    },
}
```

### Transformation examples

With `conditions: { platform: "desktop", runtime: "client" }`,
`switchBuildCondition` is replaced by the winning branch, and the dead branch
and its import are removed:

```typescript
// source
import { switchBuildCondition } from 'build-conditions';
import DesktopComponent from './Component@desktop';
import MobileComponent from './Component@mobile';

export const Component = switchBuildCondition({
    desktop: DesktopComponent,
    mobile: MobileComponent,
});

// output
import DesktopComponent from './Component@desktop';

export const Component = DesktopComponent;
```

`isBuildConditions` folds into a boolean, and statically dead `if` branches
(including `!` negation and else-if chains) are cut out:

```typescript
// source
import { isBuildConditions } from 'build-conditions';

if (isBuildConditions(['desktop', 'client'])) {
    initDesktopClient();
} else {
    initFallback();
}

// output
initDesktopClient();
```

A group set to `null` stays in runtime — only the fixed groups are folded.
With `conditions: { platform: null, runtime: "client" }`:

```typescript
// source
import { isBuildConditions } from 'build-conditions';

const isDesktop = isBuildConditions('desktop');
const isServer = isBuildConditions('server');

// output
import { isBuildConditions } from 'build-conditions';

const isDesktop = isBuildConditions('desktop'); // platform is runtime-switched
const isServer = false; // runtime is fixed to 'client'
```

### Rules enforced by the plugin

The plugin resolves a condition value to its group via `groups`, so:

- helper arguments must be literals (a string or an array of strings; the
  branch map — an object literal); passing anything dynamic is a build error —
  use `getBuildConditions` for runtime logic;
- a value not found in any group is a build error (catches typos);
- dead `if (isBuildConditions(...))` branches are removed together with
  imports that became unused; the exception is branches with `var`
  declarations (hoisting) — they are left as `if (false)` for the minifier
  to finish off;
- non-exported top-level declarations (`function`, `const`/`let`/`var` with a
  simple name) that only a dead branch referenced are removed in a cascade
  together with their imports, as long as the initializer is provably pure (a
  function, a literal, an identifier, or an object/array literal made of such
  values); calls, `new`, spread and destructuring are left to the minifier.

Rebuilding the wasm: `pnpm run build:swc-plugin` (requires Rust with the
`wasm32-wasip1` target). Tests: `pnpm run unit:swc-plugin`.

## Storybook

A per-story decorator:

```typescript
import { withBuildConditions } from 'build-conditions/testing';

export default {
    decorators: [withBuildConditions({ platform: 'desktop', runtime: 'client' })],
};
```

Switching conditions from the toolbar — the
`build-conditions/storybook-addon` entrypoint:

```typescript
// .storybook/preview.ts
import {
    createBuildConditionsGlobalTypes,
    createBuildConditionsDecorator,
} from 'build-conditions/storybook-addon';

const conditionsConfig = {
    platform: { values: ['desktop', 'mobile'], defaultValue: 'desktop' },
} as const;

export const globalTypes = createBuildConditionsGlobalTypes(conditionsConfig);
export const decorators = [createBuildConditionsDecorator(conditionsConfig)];
```

## Development

```bash
pnpm install
pnpm run unit             # jest tests of the runtime helpers and the addon
pnpm run typecheck        # tsc
pnpm run unit:swc-plugin  # cargo tests of the SWC plugin (unit + fixtures)
pnpm run storybook        # interactive demo of the runtime mode
pnpm run build            # build the wasm plugin into dist/
```

## License

MIT
