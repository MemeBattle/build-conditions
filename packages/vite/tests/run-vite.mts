/**
 * The child process of the integration test: Rolldown's napi bindings reject
 * plugin objects created in jest's VM realm, so Vite runs in a plain Node
 * process (with Node's type stripping for ../src/index.ts). Prints one JSON line.
 */
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import type { InlineConfig, Rollup } from 'vite';

import { buildConditions, type BuildConditionsPluginOptions } from '../src/index.ts';

const root = fileURLToPath(new URL('./project/', import.meta.url));

const FIXED: BuildConditionsPluginOptions = {
    groups: { platform: ['desktop', 'mobile'], runtime: ['server', 'client'] },
    conditions: { platform: 'desktop', runtime: 'client' },
};

const RUNTIME: BuildConditionsPluginOptions = {
    groups: FIXED.groups,
    conditions: { platform: null, runtime: 'client' },
};

type ViteModule = typeof import('vite');

interface ErrorReport {
    message: string;
    loc?: unknown;
    frame?: string;
}

function report(value: unknown): void {
    process.stdout.write(`RESULT ${JSON.stringify(value)}\n`);
}

function errorReport(error: unknown): ErrorReport {
    const { message, loc, frame } = error as ErrorReport;

    return { message, loc, frame };
}

async function build(vite: ViteModule, config: InlineConfig, html: string, major: 7 | 8): Promise<unknown> {
    const input = { input: `${root}${html}` };
    const result = await vite.build({
        ...config,
        configFile: false,
        logLevel: 'silent',
        root,
        build: { write: false, ...(major === 8 ? { rolldownOptions: input } : { rollupOptions: input }) },
    });
    const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[];

    return outputs
        .flatMap(output => output.output)
        .filter(item => item.type === 'chunk')
        .map(chunk => ({ fileName: chunk.fileName, code: (chunk as Rollup.OutputChunk).code }));
}

async function serve(vite: ViteModule, options: BuildConditionsPluginOptions, url: string): Promise<unknown> {
    const server = await vite.createServer({
        configFile: false,
        logLevel: 'silent',
        root,
        appType: 'custom',
        server: { middlewareMode: true, hmr: false, ws: false },
        plugins: [buildConditions(options), react()],
    });

    try {
        const result = await server.transformRequest(url);

        return { code: result?.code ?? null };
    } finally {
        await server.close();
    }
}

async function run(scenario: string): Promise<unknown> {
    const vite8: ViteModule = await import('vite');
    // vite-7 is the npm alias of vite@7, typed by its own declarations
    const vite7 = (await import('vite-7')) as unknown as ViteModule;

    switch (scenario) {
        case 'build-8':
            return build(vite8, { plugins: [buildConditions(FIXED), react()] }, 'index.html', 8);
        case 'build-7':
            return build(vite7, { plugins: [buildConditions(FIXED)], esbuild: { jsx: 'automatic' } }, 'index.html', 7);
        case 'build-runtime':
            return build(vite8, { plugins: [buildConditions(RUNTIME), react()] }, 'index.html', 8);
        case 'serve-8':
            return serve(vite8, FIXED, '/src/main.tsx');
        case 'error-build-8':
            return build(vite8, { plugins: [buildConditions(FIXED), react()] }, 'index-broken.html', 8).catch(
                errorReport
            );
        case 'error-build-7':
            return build(
                vite7,
                { plugins: [buildConditions(FIXED)], esbuild: { jsx: 'automatic' } },
                'index-broken.html',
                7
            ).catch(errorReport);
        case 'error-serve-8':
            return serve(vite8, FIXED, '/src/broken.ts').catch(errorReport);
        default:
            throw new Error(`unknown scenario ${scenario}`);
    }
}

report(await run(process.argv[2] ?? ''));
