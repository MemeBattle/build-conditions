# @memebattle/build-conditions-swc

The SWC wasm plugin of [`@memebattle/build-conditions`](https://www.npmjs.com/package/@memebattle/build-conditions):
it inlines the matching condition branch and removes the dead ones together
with their imports at build time.

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

See the [repository README](https://github.com/MemeBattle/build-conditions#readme) for the full documentation.
