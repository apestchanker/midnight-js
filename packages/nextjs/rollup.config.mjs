import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

// next/* imports must stay external — they resolve at runtime in the user's project.
const external = [/node_modules/, /^@midnight-ntwrk\//, /^next(\/|$)/];

export default [
  {
    input: 'src/index.ts',
    output: [
      { file: 'dist/index.mjs', format: 'esm', sourcemap: true },
      { file: 'dist/index.cjs', format: 'cjs', sourcemap: true },
    ],
    plugins: [typescript({ tsconfig: './tsconfig.build.json', composite: false })],
    external,
  },
  {
    input: 'src/index.ts',
    output: [
      { file: 'dist/index.d.mts', format: 'esm' },
      { file: 'dist/index.d.cts', format: 'cjs' },
      { file: 'dist/index.d.ts', format: 'esm' },
    ],
    plugins: [dts()],
    external,
  },
];
