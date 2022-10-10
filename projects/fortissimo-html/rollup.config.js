import json from '@rollup/plugin-json';
import sourcemaps from 'rollup-plugin-sourcemaps';
import { terser } from 'rollup-plugin-terser';
import typescript from '@rollup/plugin-typescript';

export default [
  {
    input: 'dist/index.js',
    output: [
      {
        file: 'dist/cjs/index.js',
        format: 'cjs'
      },
      {
        file: 'dist/fesm2015/index.js',
        format: 'es'
      }
    ],
    plugins: [
      json(),
      sourcemaps(),
      terser({ output: { max_line_len: 511 } }),
      typescript({ sourceMap: true, inlineSources: true })
    ]
  }
];
