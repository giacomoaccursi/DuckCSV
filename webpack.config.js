//@ts-check

'use strict';

const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

/** @type WebpackConfig */
const extensionConfig = {
  target: 'node',
  mode: 'none',

  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2'
  },
  externals: {
    vscode: 'commonjs vscode',
    bufferutil: 'commonjs bufferutil',
    'utf-8-validate': 'commonjs utf-8-validate',
  },
  resolve: {
    extensions: ['.ts', '.js', '.cjs'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [{ loader: 'ts-loader' }]
      }
    ]
  },
  plugins: [
    // Copy DuckDB WASM files to dist/ so they can be found at runtime
    new CopyPlugin({
      patterns: [
        {
          from: 'node_modules/@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm',
          to: 'duckdb-mvp.wasm'
        },
        {
          from: 'node_modules/@duckdb/duckdb-wasm/dist/duckdb-eh.wasm',
          to: 'duckdb-eh.wasm'
        },
        {
          from: 'node_modules/@duckdb/duckdb-wasm/dist/duckdb-node-mvp.worker.cjs',
          to: 'duckdb-node-mvp.worker.cjs'
        },
        {
          from: 'node_modules/@duckdb/duckdb-wasm/dist/duckdb-node-eh.worker.cjs',
          to: 'duckdb-node-eh.worker.cjs'
        },
      ]
    })
  ],
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: "log",
  },
};
module.exports = [ extensionConfig ];
