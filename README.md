# @memebattle/build-conditions

Build-time code splitting by arbitrary conditions. You declare extensible
**condition groups** (`platform`, `runtime`, build A/B experiments, and so on),
branch your code with two tiny helpers, and get per-condition bundles: an SWC
or Vite plugin inlines the matching branch and removes the dead ones together
with their imports. Without a plugin the same code keeps working at runtime, so
tests, Storybook and dev setups need no special build.

- **Type-safe** — condition values are checked by TypeScript; mixing groups or
  misspelling a value is a compile-time error.
- **Runtime fallback** — every helper has a runtime implementation; the build
  plugins are an optimization, not a requirement.
- **Whole-branch elimination** — dead branches disappear from the bundle along
  with the imports only they used.

## Packages

The repository is a pnpm workspace of three packages, released together under
one version number:

| Package                                              | Purpose                                                                            | Dependencies                                                         |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [`@memebattle/build-conditions`](packages/core)      | the runtime helpers, `./testing`, `./storybook-addon` and the `PluginOptions` type | none; `react` is an optional peer                                    |
| [`@memebattle/build-conditions-swc`](packages/swc)   | the SWC wasm plugin (swc, rspack, Next.js)                                         | none                                                                 |
| [`@memebattle/build-conditions-vite`](packages/vite) | the Vite plugin, a JS port of the SWC plugin                                       | `oxc-parser`, `magic-string`; `vite >=6.3` peer (7 and 8 are tested) |

Neither plugin depends on the core package at runtime. Install the core
package as a dependency and one of the plugins as a dev dependency.

## Declaring condition groups

Groups are declared via declaration merging. Condition values must be unique
across all groups — a value is resolved to its group by the value itself:

```typescript
declare module '@memebattle/build-conditions' {
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
import { switchBuildCondition } from '@memebattle/build-conditions';
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
import { isBuildConditions } from '@memebattle/build-conditions';

if (isBuildConditions(['desktop', 'client'])) {
    // code for the desktop client bundle only
}
```

Without a build plugin both helpers work at runtime: `switchBuildCondition`
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
import { setBuildConditionsStorage, type PartialBuildConditions } from '@memebattle/build-conditions';

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

`@memebattle/build-conditions-swc` is a WASM plugin (`packages/swc/`, Rust,
built against `swc_core` 79; the `swc_ast_unknown` cfg keeps it working with
newer swc_core runners). The configuration lists the complete composition of
the groups plus the chosen value of each group — or `null` when the group is
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
                    require.resolve('@memebattle/build-conditions-swc'),
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

## Vite plugin

`@memebattle/build-conditions-vite` brings the same transform to Vite, whose
Rolldown and Oxc pipeline has no SWC and does not load wasm plugins. It is a JS
port of the SWC plugin: it parses with `oxc-parser` and edits only the helper
call sites, the dead branches, the dead declarations and the dead imports with
`magic-string`. Types, comments and formatting everywhere else stay as they
were, and a hires sourcemap maps the result back.

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

- The plugin is `enforce: 'pre'`: it runs before `@vitejs/plugin-react`,
  which still sees the JSX it needs for Fast Refresh.
- The config is the one of the SWC plugin, with the same semantics: a group set
  to `null` stays in runtime mode. It applies to `vite build` and `vite dev`
  alike; an invalid config throws when `buildConditions()` is called.
- Build errors use the messages of the SWC plugin and arrive with a code frame.
- A hook filter skips every file whose code does not mention
  `@memebattle/build-conditions`. Files under `node_modules` and ids with a
  query (`?raw`, `?worker`) are not transformed.
- The options are typed by your `BuildConditionGroups` declaration when the
  `vite.config.ts` program sees it (for example through the `include` of
  `tsconfig.node.json`); otherwise they fall back to plain string records.

## Transforms of both plugins

The examples and rules below apply to the SWC and the Vite plugin alike.

### Transformation examples

With `conditions: { platform: "desktop", runtime: "client" }`,
`switchBuildCondition` is replaced by the winning branch, and the dead branch
and its import are removed:

```typescript
// source
import { switchBuildCondition } from '@memebattle/build-conditions';
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
import { isBuildConditions } from '@memebattle/build-conditions';

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
import { isBuildConditions } from '@memebattle/build-conditions';

const isDesktop = isBuildConditions('desktop');
const isServer = isBuildConditions('server');

// output
import { isBuildConditions } from '@memebattle/build-conditions';

const isDesktop = isBuildConditions('desktop'); // platform is runtime-switched
const isServer = false; // runtime is fixed to 'client'
```

### Rules enforced by the plugins

The plugins resolve a condition value to its group via `groups`, so:

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

### Shared fixtures

Both plugins are tested against the cases in `fixtures/` at the repository
root (`fixed/`, `partial/` and `errors/`, each with an `input.js` and the
expected `output.js` or `output.stderr`), so no case is added to one plugin
without the other. The expected outputs are swc codegen: regenerate them with
`UPDATE=1 cargo test --test fixture` in `packages/swc` and review the diff. The
jest suite of the Vite plugin runs the same cases with the same configs and
compares normalized ASTs, because the port keeps the original formatting.

## Storybook

A per-story decorator:

```typescript
import { withBuildConditions } from '@memebattle/build-conditions/testing';

export default {
    decorators: [withBuildConditions({ platform: 'desktop', runtime: 'client' })],
};
```

Switching conditions from the toolbar — the
`@memebattle/build-conditions/storybook-addon` entrypoint:

```typescript
// .storybook/preview.ts
import {
    createBuildConditionsGlobalTypes,
    createBuildConditionsDecorator,
} from '@memebattle/build-conditions/storybook-addon';

const conditionsConfig = {
    platform: { values: ['desktop', 'mobile'], defaultValue: 'desktop' },
} as const;

export const globalTypes = createBuildConditionsGlobalTypes(conditionsConfig);
export const decorators = [createBuildConditionsDecorator(conditionsConfig)];
```

## Development

All commands run from the repository root:

```bash
pnpm install
pnpm run unit             # jest: the runtime helpers and the addon (core), the Vite plugin (vite)
pnpm run typecheck        # tsc -b over packages/core and packages/vite
pnpm run fmt:check        # oxfmt
pnpm run unit:swc-plugin  # cargo tests of the SWC plugin (unit + fixtures)
pnpm run storybook        # interactive demo of the runtime mode
pnpm run build            # packages/swc/dist (wasm, needs Rust with wasm32-wasip1) and packages/vite/dist (tsdown)
```

The Vite plugin can be tried in `vite dev` on the integration test project:
`cd packages/vite && pnpm exec vite --config tests/project/vite.config.mts tests/project`.

## Releasing

The three packages are released together, under one version number. Releases
are published from GitHub Actions by hand: bump `version` in all three
`packages/*/package.json`, merge to `main`, then run the **Publish to npm**
workflow from the Actions tab (pick the dist-tag; `dry-run` goes through every
step except the publish). The job runs in the `npm` environment, so it waits
for one of the environment's required reviewers to approve it in the Actions
UI before it starts. It then checks formatting, type-checks, runs the jest and
cargo tests and builds both plugins. It refuses differing versions, a version
whose tag exists or that any of the packages already has on npm, packs the
three tarballs with `pnpm pack`, prints and checks their contents, publishes
each of them with provenance, then pushes a `v<version>` tag and creates the
GitHub release. `main` accepts pull requests only.

The tarballs contain `README.md`, `LICENSE` and:

- `@memebattle/build-conditions`: `src/` minus tests, stories and the
  test-only group declarations;
- `@memebattle/build-conditions-swc`: `dist/swc_plugin_build_conditions.wasm`;
- `@memebattle/build-conditions-vite`: `dist/index.js` and `dist/index.d.ts`.

Check them locally with `pnpm run build`, then `pnpm pack` in each package
directory and `node .github/scripts/check-tarballs.mjs <version> *.tgz`.

Each package publishes through npm trusted publishing, bound to the workflow
and the `npm` environment. Trusted publishing can be bound only to a package
that exists, so the first release of a new package name goes out with a
temporary `NPM_TOKEN` repository secret (a granular access token with publish
rights). After that release, bind the new name with
`npm trust github <name> --repo MemeBattle/build-conditions --file publish.yml --environment npm --allow-publish`
and delete the secret. If a release fails after publishing some of the
packages, rerunning it hits the version guard: bump the patch version and
release again.

## License

MIT
