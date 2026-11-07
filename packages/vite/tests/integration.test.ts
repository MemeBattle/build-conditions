/**
 * Vite builds and the dev-server transform of tests/project. Vite runs in a
 * child Node process (see run-vite.mts): Rolldown's bindings reject plugin
 * objects created in jest's VM realm.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RUNNER = fileURLToPath(new URL('./run-vite.mts', import.meta.url));
const TIMEOUT = 60_000;

const UNKNOWN_TABLET =
    "build-conditions: condition value 'tablet' is not found in any group of the config (groups: platform, runtime)";

interface Chunk {
    fileName: string;
    code: string;
}

interface ErrorReport {
    message: string;
    loc?: { line: number; column: number };
    frame?: string;
}

function runVite<T>(scenario: string): T {
    const stdout = execFileSync(process.execPath, [RUNNER, scenario], {
        encoding: 'utf8',
        env: { ...process.env, NODE_OPTIONS: '' },
    });
    const line = stdout.split('\n').find(item => item.startsWith('RESULT '));

    if (line === undefined) {
        throw new Error(`no result from ${scenario}:\n${stdout}`);
    }

    return JSON.parse(line.slice('RESULT '.length)) as T;
}

const jsChunks = (chunks: Chunk[]): Chunk[] => chunks.filter(chunk => chunk.fileName.endsWith('.js'));
const anyChunkContains = (chunks: Chunk[], text: string): boolean => chunks.some(chunk => chunk.code.includes(text));

describe('vite integration', () => {
    test.each(['build-8', 'build-7'])(
        '%s: the dead branch and its chunk are absent',
        scenario => {
            const chunks = runVite<Chunk[]>(scenario);

            expect(anyChunkContains(chunks, 'DESKTOP_HEADER')).toBe(true);
            expect(anyChunkContains(chunks, 'MOBILE_HEADER')).toBe(false);
            expect(anyChunkContains(chunks, 'MOBILE_ONLY_CHUNK')).toBe(false);
            // The runtime helpers are not bundled
            expect(anyChunkContains(chunks, '__BUILD_CONDITIONS__')).toBe(false);
            expect(chunks.some(chunk => chunk.fileName.includes('mobile-only'))).toBe(false);
            expect(jsChunks(chunks)).toHaveLength(1);
        },
        TIMEOUT
    );

    test(
        'build-runtime: a null group stays in runtime mode',
        () => {
            const chunks = runVite<Chunk[]>('build-runtime');

            expect(anyChunkContains(chunks, 'DESKTOP_HEADER')).toBe(true);
            expect(anyChunkContains(chunks, 'MOBILE_HEADER')).toBe(true);
            expect(anyChunkContains(chunks, '__BUILD_CONDITIONS__')).toBe(true);
        },
        TIMEOUT
    );

    test(
        'serve-8: the dev server transform runs before plugin-react',
        () => {
            const { code } = runVite<{ code: string }>('serve-8');

            expect(code).not.toContain('Header@mobile');
            expect(code).not.toContain('switchBuildCondition(');
            // plugin-react still compiled the JSX after the plugin ran
            expect(code).toContain('jsx');
            expect(code).not.toContain('<Header');
        },
        TIMEOUT
    );

    test.each(['error-build-8', 'error-build-7'])(
        '%s: the build fails with the plugin message',
        scenario => {
            expect(runVite<ErrorReport>(scenario).message).toContain(UNKNOWN_TABLET);
        },
        TIMEOUT
    );

    test(
        'error-serve-8: the error carries a location and a code frame',
        () => {
            const error = runVite<ErrorReport>('error-serve-8');

            expect(error.message).toBe(UNKNOWN_TABLET);
            expect(error.loc?.line).toBe(4);
            expect(error.frame).toEqual(expect.stringContaining("isBuildConditions('tablet')"));
        },
        TIMEOUT
    );
});
