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
    new CopyPlugin({
      patterns: [
        { from: 'node_modules/@duckdb/duckdb-wasm/dist/duckdb-eh.wasm', to: 'duckdb-eh.wasm' },
        { from: 'node_modules/@duckdb/duckdb-wasm/dist/duckdb-node-eh.worker.cjs', to: 'duckdb-node-eh.worker.cjs' },
      ]
    })
  ],
  devtool: 'nosources-source-map',
  infrastructureLogging: { level: "log" },
};

/** @type WebpackConfig */
const workerConfig = {
  target: 'node',
  mode: 'none',
  entry: './src/workers/duckdb-worker.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'duckdb-worker.js',
    libraryTarget: 'commonjs2'
  },
  externals: {
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
  devtool: 'nosources-source-map',
};

module.exports = [extensionConfig, workerConfig];
