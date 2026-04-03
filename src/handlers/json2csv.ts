// future implementation of json converison
// todo: implement as format, cleanup, make pr with examples json->csv
interface Flat {
    header: string[];
    data: string[][];
}

type Primitive = string | number | boolean | symbol | bigint | null | undefined;
type Path = string[];
const pathEsc = '\\';
const pathSep = '.';

function main() {
    const k = '11';
    const x = flatten(samples[k]);
    console.error(samples[k]);
    console.log(csv(x));
    //testPathFormat();
}

function markdown(x: Flat) {
    function mdrow(arr: string[]) {
        return `|${arr.map(row => row.replaceAll('\\', '\\\\').replaceAll('|', '\\|')).join('|')}|`;
    }
    const node = `|${Array(x.header.length).fill('-').join('|')}|`;
    return [mdrow(x.header), node, ...x.data.map(row => mdrow(row))].join('\n');
}

function csv(x: Flat) {
    function csvrow(arr: string[], sep = ',', quot = '"') {
        return arr.map(x => (x.includes(sep) ? `${quot}${sep.replace(quot, quot + quot)}${quot}` : x)).join(sep);
    }
    return [x.header, ...x.data].map(row => csvrow(row)).join('\n');
}

function flatten(x: unknown): Flat {
    // Non-object: 1*1 "table"
    if (!isBag(x)) {
        return {
            header: ['value'],
            data: [[stringify(x)]],
        };
    }
    const paths = Array.from(gPaths(x, 'primitives'), ([k]) => k);
    const splits = solveTableSplit({
        paths,
        log: console.error,
    });
    // we have our split for each path
    // keep distinct row and col fragments
    // place values based on path [R, C]

    // omit key if all rows are empty
    const rows = splits.every(s => s === 0)
        ? null
        : removeDuplicates(paths.map((p, i) => encodePath(p.slice(0, splits[i]))));
    const rowCount = rows?.length ?? 1;
    const hasRowKeys = rows !== null;
    const cols = removeDuplicates(paths.map((p, i) => encodePath(p.slice(splits[i]))));

    const data = Array.from({ length: rowCount }, () => new Array(+hasRowKeys + cols.length));

    for (let i = 0; i < rowCount; ++i) {
        const row = decodePath(rows?.[i]);
        if (hasRowKeys) data[i][0] = rows[i] ?? '';
        for (let j = 0; j < cols.length; ++j) {
            const path = [...row, ...decodePath(cols[j])];
            data[i][+hasRowKeys + j] = stringify(follow(path, x));
        }
    }

    return {
        header: [...(hasRowKeys ? ['key'] : []), ...cols.map(col => col ?? 'value')],
        data,
    };
}

// remove duplicates, preserve order
function removeDuplicates<T extends Primitive>(arr: T[]): T[] {
    const seen = new Set(arr);
    return arr.filter(item => seen.delete(item));
}

function stringify(x: unknown) {
    return isEmpty(x) ? '' : isBag(x) ? JSON.stringify(x) : String(x);
}

function follow(path: Readonly<Path>, x: unknown): unknown {
    let item: any = x;
    for (let i = 0; i < path.length && !isEmpty(item); item = item[path[i++]]) {}
    return item;
}

function isEmpty(x: unknown) {
    return x === undefined || x === '' || x === null;
}

/* 
a,b -> a.b
a.b -> a\.b
a\,b -> a\\.b
a\.b -> a\\\.b 
a\\,b -> a\\\\.b
a\\.b -> a\\\\\.b

count \ before dot
if even -> split, add n/2 \ at the end
if odd -> dot, add (n-1)/2 \ as the end
 */

function testPathFormat() {
    const cases = [
        ['a', 'b'],
        ['a.b'],
        ['a\\', 'b'],
        ['a\\.b'],
        [`a\\\\`, 'b'],
        ['a\\\\.b'],
        ['a..b'],
        ['', ''],
        ['.'],
        ['', '.'],
        ['.', '', '\\'],
        ['.', '\\', '.'],
        ['', '\\', ''],
        ['in\\the', 'mid\\le', 'yeah'],
        [''],
        [],
    ];
    console.log('source', 'encoded', 'roundtrips');
    for (const c of cases) {
        console.log(
            c,
            encodePath(c),
            decodePath(encodePath(c)),
            decodePath(encodePath(c)).every((x, i) => x === c[i])
        );
    }
}

function encodePath(path: Readonly<Path>): string | null {
    if (!path.length) return null;
    return path
        .map((part, i) => {
            // possible optimiation: if !part.includes(sep) return part

            let out = '';
            let carets = 0;

            for (let i = 0; i < part.length; i++) {
                const c = part[i];

                if (c === pathEsc) {
                    carets++;
                } else if (c === pathSep) {
                    out += pathEsc.repeat(carets * 2 + 1) + pathSep;
                    carets = 0;
                } else {
                    out += pathEsc.repeat(carets) + c;
                    carets = 0;
                }
            }
            out += pathEsc.repeat(carets * (1 + +(i < path.length - 1)));
            return out;
        })
        .join('.');
}

function decodePath(path: string | null | undefined) {
    // possible optimiation: if !path.includes(esc) return path.split(sep)
    if (path === null || path === undefined) return [];
    const parts: string[] = [];
    let current = '';
    let carets = 0;

    for (let i = 0; i < path.length; i++) {
        const c = path[i];

        if (c === pathEsc) {
            carets++;
            continue;
        }

        if (c === pathSep) {
            if (carets % 2 === 0) {
                current += pathEsc.repeat(carets / 2);
                parts.push(current);
                current = '';
            } else {
                current += pathEsc.repeat((carets - 1) / 2) + pathSep;
            }
            carets = 0;
            continue;
        }

        current += pathEsc.repeat(carets);
        carets = 0;
        current += c;
    }

    current += pathEsc.repeat(carets);
    parts.push(current);
    return parts;
}

export function solveTableSplit({ paths, log }: { paths: Path[]; log?: (...args: unknown[]) => void }): number[] {
    if (!paths.length) return [];

    const N = paths.map(p => p.length).reduce((max, x) => (x < max ? max : x));
    const R = new Set<Primitive>();
    const C = new Set<Primitive>();
    // fixed split method.
    // 1. choose a k in 0..N-1 . it is the maximum prefix length.
    // 2. count how many R and C would exist at that split
    // 3. update best k vector based on minimum cost
    let best: SolverState = { rows: Infinity, cols: Infinity, K: [] };
    // prefixes (vary column length)
    let logMode: string = 'prefix';
    splitCost((k, p) => Math.min(k, p.length - 1));
    // suffixes (vary row length)
    logMode = 'suffix';
    splitCost((k, p) => p.length - Math.min(k, p.length - 1));
    console.log(best);
    return best.K;

    function splitCost(chooseK_: (k: number, p: Path) => number) {
        for (let k = 0; k < N; ++k) {
            R.clear();
            C.clear();

            const logSplits: { r: string; k_: number; c: string }[] | null = log ? [] : null;
            const K = paths.map(p => {
                if (!p.length)
                    throw new Error(
                        "path shouldn't be empty. empty path only occurs on primitive values can be the only path of a primitve value"
                    );
                let k_ = chooseK_(k, p);
                // r and c may be empty
                const r = encodePath(p.slice(0, k_)); // may be empty
                const c = encodePath(p.slice(k_)); // must not be empty
                logSplits?.push({ r: r?.toString() ?? '', k_, c: c?.toString() ?? '' });

                R.add(r);
                C.add(c);
                return k_;
            });
            const state = { rows: R.size, cols: C.size, K };
            const maxRlen = logSplits?.reduce((cur, x) => Math.max(cur, x.r.length), 0);
            logSplits?.forEach(({ r, k_, c }) =>
                log?.(logMode, k, 'split', r.toString().padStart(maxRlen!), k_, c.toString())
            );
            const isBetter = compare(state, best) > 0;
            log?.(logMode, k, 'result', `rows:${state.rows}`, `cols:${state.cols}`, isBetter ? 'NEW BEST' : '');
            if (isBetter) {
                best = state;
            }
        }
    }
}

type SolverState = { rows: number; cols: number; K: number[] };

// >0 if a is better than b
// <0 if b is better then a
// 0 if rows and cols are equal
function compare(a: SolverState, b: SolverState) {
    return (
        b.rows + b.cols - a.rows - a.cols || // minimize rows + cols
        b.cols - a.cols || // minimize cols
        a.rows - b.rows // maximize rows
    );
}

function gPaths(x: unknown, to: 'primitives', p?: Path, visited?: Set<unknown>): Generator<[p: Path, v: Primitive]>;
function gPaths(x: unknown, to: 'objects', p?: Path, visited?: Set<unknown>): Generator<[p: Path, v: object]>;
function gPaths(
    x: unknown,
    to: 'primitives' | 'objects',
    p: Path,
    visited?: Set<unknown>
): Generator<[p: Path, v: unknown]>;
function* gPaths(
    x: unknown,
    to: 'primitives' | 'objects',
    p: Path = [],
    visited = new Set<unknown>()
): Generator<[p: Path, v: unknown]> {
    if (isBag(x)) visited.add(x);
    for (const [k, v] of gChildren(x)) {
        if (visited.has(v)) throw new Error(`cycle detected ${k} ${v}`);
        yield* gPaths(v, to, [...p, k], visited);
    }
    if ((to === 'objects') === isBag(x)) {
        yield [p, x];
    }
}

// does this value have properties.
function isBag(x: unknown): x is object | Function {
    return (typeof x === 'object' && x !== null) || typeof x === 'function';
}

function* gChildren(x: unknown): Generator<[k: Path[number], v: unknown]> {
    if (!isBag(x)) return;
    yield* Object.entries(x);
}

const cyclicObject: any = { normal: 1 };
cyclicObject.here = cyclicObject;
cyclicObject.there = cyclicObject;
const samples = {
    pkg: {
        name: 'p2r3-convert',
        productName: 'Convert to it!',
        author: 'PortalRunner',
        description: 'Truly universal browser-based file converter',
        private: true,
        version: '0.0.0',
        type: 'module',
        main: 'src/electron.cjs',
        scripts: {
            dev: 'vite',
            build: 'tsc && vite build',
            'cache:build': 'bun run buildCache.js dist/cache.json --minify',
            'cache:build:dev': 'bun run buildCache.js dist/cache.json',
            preview: 'vite preview',
            docker: 'bun run docker:build && bun run docker:up',
            'docker:build':
                'docker compose -f docker/docker-compose.yml -f docker/docker-compose.override.yml build --build-arg VITE_COMMIT_SHA=$(git rev-parse HEAD)',
            'docker:up': 'docker compose -f docker/docker-compose.yml -f docker/docker-compose.override.yml up -d',
            'desktop:build': 'tsc && IS_DESKTOP=true vite build && bun run cache:build',
            'desktop:preview': 'electron .',
            'desktop:start': 'bun run desktop:build && bun run desktop:preview',
            'desktop:dist:win': 'bun run desktop:build && electron-builder --win --publish never',
            'desktop:dist:mac': 'bun run desktop:build && electron-builder --mac --publish never',
            'desktop:dist:linux': 'bun run desktop:build && electron-builder --linux --publish never',
        },
        build: {
            appId: 'com.p2r3.convert',
            directories: {
                output: 'release',
            },
            files: ['dist/**/*', 'src/electron.cjs'],
            win: {
                target: 'nsis',
            },
            mac: {
                target: 'dmg',
            },
            linux: {
                target: 'AppImage',
            },
        },
        devDependencies: {
            '@types/hjson': '^2.4.6',
            '@types/jszip': '^3.4.0',
            '@types/msgpack': '^0.0.34',
            '@types/opentype.js': '^1.3.9',
            electron: '^40.6.0',
            'electron-builder': '^26.8.1',
            puppeteer: '^24.36.0',
            typescript: '~5.9.3',
            vite: '^7.2.4',
            'vite-tsconfig-paths': '^6.0.5',
        },
        dependencies: {
            '@ably/msgpack-js': '^0.4.1',
            '@bjorn3/browser_wasi_shim': '^0.4.2',
            '@bokuweb/zstd-wasm': '^0.0.27',
            '@ffmpeg/core': '^0.12.10',
            '@ffmpeg/ffmpeg': '^0.12.15',
            '@ffmpeg/util': '^0.12.2',
            '@flo-audio/reflo': '^0.1.2',
            '@imagemagick/magick-wasm': '^0.0.37',
            '@shelacek/ubjson': '^1.1.1',
            '@sqlite.org/sqlite-wasm': '^3.51.2-build6',
            '@stringsync/vexml': '^0.1.8',
            '@toon-format/toon': '^2.1.0',
            '@types/bun': '^1.3.9',
            '@types/meyda': '^5.3.0',
            '@types/pako': '^2.0.4',
            '@types/papaparse': '^5.5.2',
            '@types/three': '^0.182.0',
            bson: '^7.2.0',
            cbor: '^10.0.12',
            hjson: '^3.2.2',
            imagetracer: '^0.2.2',
            'js-synthesizer': '^1.11.0',
            json6: '^1.0.3',
            'jsonl-parse-stringify': '^1.0.3',
            jszip: '^3.10.1',
            meyda: '^5.6.3',
            mime: '^4.1.0',
            nanotar: '^0.3.0',
            nbtify: '^2.2.0',
            'opentype.js': '^1.3.4',
            pako: '^2.1.0',
            papaparse: '^5.5.3',
            'pdf-parse': '^2.4.5',
            'pdftoimg-js': '^0.2.5',
            'pe-library': '^2.0.1',
            'svg-pathdata': '^8.0.0',
            three: '^0.182.0',
            'three-bvh-csg': '^0.0.17',
            'three-mesh-bvh': '^0.9.8',
            'tiny-jsonc': '^1.0.2',
            'ts-flp': '^1.0.3',
            verovio: '^6.0.1',
            vexflow: '^5.0.0',
            'vite-plugin-static-copy': '^3.1.6',
            wavefile: '^11.0.0',
            'woff2-encoder': '^2.0.0',
            xml2js: '^0.6.2',
            'xz-decompress': '^0.2.3',
            yaml: '^2.8.2',
        },
    },
    pkglock: {
        name: 'laravel',
        lockfileVersion: 3,
        requires: true,
        packages: {
            '': {
                dependencies: {
                    '@tailwindcss/vite': '^4.1.18',
                    tailwindcss: '^4.1.18',
                },
            },
            'node_modules/@esbuild/aix-ppc64': {
                version: '0.27.2',
                resolved: 'https://registry.npmjs.org/@esbuild/aix-ppc64/-/aix-ppc64-0.27.2.tgz',
                integrity:
                    'sha512-GZMB+a0mOMZs4MpDbj8RJp4cw+w1WV5NYD6xzgvzUJ5Ek2jerwfO2eADyI6ExDSUED+1X8aMbegahsJi+8mgpw==',
                cpu: ['ppc64'],
                license: 'MIT',
                optional: true,
                os: ['aix'],
                peer: true,
                engines: {
                    node: '>=18',
                },
            },
            'node_modules/@esbuild/android-arm': {
                version: '0.27.2',
                resolved: 'https://registry.npmjs.org/@esbuild/android-arm/-/android-arm-0.27.2.tgz',
                integrity:
                    'sha512-DVNI8jlPa7Ujbr1yjU2PfUSRtAUZPG9I1RwW4F4xFB1Imiu2on0ADiI/c3td+KmDtVKNbi+nffGDQMfcIMkwIA==',
                cpu: ['arm'],
                license: 'MIT',
                optional: true,
                os: ['android'],
                peer: true,
                engines: {
                    node: '>=18',
                },
            },
            'node_modules/@esbuild/android-arm64': {
                version: '0.27.2',
                resolved: 'https://registry.npmjs.org/@esbuild/android-arm64/-/android-arm64-0.27.2.tgz',
                integrity:
                    'sha512-pvz8ZZ7ot/RBphf8fv60ljmaoydPU12VuXHImtAs0XhLLw+EXBi2BLe3OYSBslR4rryHvweW5gmkKFwTiFy6KA==',
                cpu: ['arm64'],
                license: 'MIT',
                optional: true,
                os: ['android'],
                peer: true,
                engines: {
                    node: '>=18',
                },
            },
            'node_modules/@esbuild/android-x64': {
                version: '0.27.2',
                resolved: 'https://registry.npmjs.org/@esbuild/android-x64/-/android-x64-0.27.2.tgz',
                integrity:
                    'sha512-z8Ank4Byh4TJJOh4wpz8g2vDy75zFL0TlZlkUkEwYXuPSgX8yzep596n6mT7905kA9uHZsf/o2OJZubl2l3M7A==',
                cpu: ['x64'],
                license: 'MIT',
                optional: true,
                os: ['android'],
                peer: true,
                engines: {
                    node: '>=18',
                },
            },
        },
    },
    '{}': {},
    '[]': [],
    1: undefined,
    2: '',
    3: 'hello wolrld',
    4: { a: 1, b: 2 },
    5: { a: { x: 1 }, b: { x: 2 }, c: 1 },
    6: { a: [{}], b: [{}], c: [[{}]] },
    7: {
        C: { A: { x: { a: 1, b: 2 } } },
        B: { x: { a: 1, b: 2 } },
    },
    8: [
        { a: 'A', b: 'B' },
        { a: 'A', b: 'B' },
        { a: 'A', b: 'B', c: 'C' },
    ],
    9: {
        a: 1,
        b: {
            a: 2,
            c: 3,
            b: {
                c: 4,
            },
        },
    },
    10: {
        a: {
            p: {
                q1: 1,
            },
            r: {
                q2: 2,
            },
        },
        b: {
            c: {
                s1: 3,
                s2: 4,
            },
            d: {
                s1: 5,
                s2: 6,
            },
        },
    },
    11: {
        emp_001: {
            profile: {
                name: 'Alice Wong',
                department: 'Engineering',
                level: 4,
            },
            location: {
                office: 'NYC',
                desk: '5A-12',
            },
            compensation: {
                salary: 145000,
                bonusPct: 0.12,
            },
            status: 'active',
        },
        emp_002: {
            profile: {
                name: 'Bruno Silva',
                department: 'Engineering',
                level: 3,
            },
            location: {
                office: 'NYC',
                desk: '5A-18',
            },
            compensation: {
                salary: 118000,
                bonusPct: 0.08,
            },
            status: 'leave',
        },
        emp_003: {
            profile: {
                name: 'Carla Mendes',
                department: 'Design',
                level: 3,
            },
            location: {
                office: 'Remote',
                timezone: 'UTC-3',
            },
            compensation: {
                salary: 99000,
                bonusPct: 0.07,
            },
            status: 'active',
        },
        emp_004: {
            profile: {
                name: 'Dae Kim',
                department: 'Engineering',
                level: 5,
            },
            location: {
                office: 'SF',
                desk: '2C-04',
            },
            compensation: {
                salary: 172000,
                bonusPct: 0.15,
                stockGrant: 40000,
            },
            status: 'active',
        },
        emp_005: {
            profile: {
                name: 'Elena Rossi',
                department: 'Finance',
                level: 2,
            },
            location: {
                office: 'London',
                desk: '1F-03',
            },
            compensation: {
                salary: 87000,
                bonusPct: 0.05,
            },
            status: 'contractor',
            manager: {
                id: 'emp_010',
                name: 'Victor Hale',
            },
        },
    },
    12: {
        order_1001: {
            customer: {
                name: 'Iris Market',
                tier: 'gold',
            },
            shipping: {
                city: 'Berlin',
                country: 'DE',
            },
            totals: {
                subtotal: 120.5,
                tax: 22.9,
                grand: 143.4,
            },
            state: 'paid',
        },
        order_1002: {
            customer: {
                name: 'Northwind Labs',
                tier: 'silver',
            },
            shipping: {
                city: 'Paris',
                country: 'FR',
            },
            totals: {
                subtotal: 80,
                tax: 16,
                grand: 96,
            },
            state: 'paid',
        },
        order_1003: {
            customer: {
                name: 'Sun Harbor',
                tier: 'gold',
            },
            pickup: {
                store: 'AMS-04',
                window: '10:00-12:00',
            },
            totals: {
                subtotal: 48,
                tax: 0,
                grand: 48,
            },
            state: 'pickup',
        },
    },
    13: {
        emp_001: {
            profile: {
                name: 'Elena Rossi',
                department: 'Finance',
                level: 2,
            },
            location: {
                office: 'Remote',
                timezone: 'UTC-3',
            },
        },
        emp_002: {
            profile: {
                name: 'Dae Kim',
                department: 'Engineering',
                level: 5,
            },
            location: {
                office: 'NYC',
                desk: '5A-12',
            },
        },
        emp_003: { audit: { createdAt: '...', updatedAt: '...' } },
        emp_004: { audit: { createdAt: '...', updatedAt: '...' } },
        emp_005: { audit: { createdAt: '...', updatedAt: '...' } },
        emp_006: { audit: { createdAt: '...', updatedAt: '...' } },
        emp_007: { audit: { createdAt: '...', updatedAt: '...' } },
    },
    cycles: cyclicObject,
    tie1: {
        a: { p: { q: 1 }, r: { q: 1 } },
        b: { s: { q: 1 } },
    },
    tie2: {
        a: { p: { q: 1 }, r: { q: 1 } },
        b: { s: { t: 1 }, u: { t: 1 } },
    },
    t: { A: { B: { a: 1, b: 1 }, C: { a: 1, b: 1 } }, a: 1, b: 1 },
} as const;

main();
