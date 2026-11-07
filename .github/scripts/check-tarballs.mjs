// Prints the contents of the packed tarballs and checks them against the
// rules of each package. Usage: node check-tarballs.mjs <version> <tgz>...
import { execFileSync } from 'node:child_process';

const [version, ...tarballs] = process.argv.slice(2);

if (!version || tarballs.length === 0) {
    console.error('usage: check-tarballs.mjs <version> <tgz>...');
    process.exit(1);
}

const SWC_FILES = ['LICENSE', 'README.md', 'dist/swc_plugin_build_conditions.wasm', 'package.json'];

const rules = {
    '@memebattle/build-conditions': ({ files }) => [
        !files.includes('src/index.ts') && 'src/index.ts is missing',
        ...files
            .filter(file => /\.(test|story)\.|testGroups\.d\.ts|^\.config\/|^dist\//.test(file))
            .map(file => `unexpected file ${file}`),
    ],
    '@memebattle/build-conditions-swc': ({ files }) =>
        JSON.stringify([...files].sort()) === JSON.stringify(SWC_FILES)
            ? []
            : [`expected exactly ${SWC_FILES.join(', ')}, got ${files.join(', ')}`],
    '@memebattle/build-conditions-vite': ({ files, manifest, read }) => [
        !files.includes('dist/index.js') && 'dist/index.js is missing',
        !files.includes('dist/index.d.ts') && 'dist/index.d.ts is missing',
        ...files.filter(file => /^(src|tests)\//.test(file)).map(file => `unexpected file ${file}`),
        manifest.includes('workspace:') && 'package.json still has a workspace: range',
        files.includes('dist/index.d.ts') &&
            !read('dist/index.d.ts').includes('@memebattle/build-conditions') &&
            'dist/index.d.ts does not import the types of @memebattle/build-conditions',
    ],
};

let failed = false;
const seen = new Set();

for (const tarball of tarballs) {
    const read = file => execFileSync('tar', ['-xOzf', tarball, `package/${file}`], { encoding: 'utf8' });
    const listing = execFileSync('tar', ['-tvzf', tarball], { encoding: 'utf8' }).trim().split('\n');
    const files = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
        .trim()
        .split('\n')
        .map(file => file.replace(/^package\//, ''));
    const manifest = read('package.json');
    const { name, version: packed } = JSON.parse(manifest);

    console.log(`\n${name}@${packed} (${tarball})`);
    console.log(listing.join('\n'));

    const check = rules[name];
    const problems = [
        !check && `unknown package ${name}`,
        packed !== version && `version ${packed} differs from ${version}`,
        ...(check ? check({ files, manifest, read }) : []),
    ].filter(Boolean);

    for (const problem of problems) {
        console.error(`::error::${name}: ${problem}`);
    }

    failed ||= problems.length > 0;
    seen.add(name);
}

for (const name of Object.keys(rules)) {
    if (!seen.has(name)) {
        console.error(`::error::no tarball for ${name}`);
        failed = true;
    }
}

process.exit(failed ? 1 : 0);
