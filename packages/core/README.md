# @memebattle/build-conditions

Build-time code splitting by arbitrary conditions: the runtime helpers
(`switchBuildCondition`, `isBuildConditions`, the conditions storage), the
`./testing` and `./storybook-addon` entrypoints and the `PluginOptions` type.

The build plugins live in their own packages:

- [`@memebattle/build-conditions-swc`](https://www.npmjs.com/package/@memebattle/build-conditions-swc), the SWC wasm plugin;
- [`@memebattle/build-conditions-vite`](https://www.npmjs.com/package/@memebattle/build-conditions-vite), the Vite plugin.

See the [repository README](https://github.com/MemeBattle/build-conditions#readme) for the full documentation.
