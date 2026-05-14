declare module 'alasql' {
  function alasql(sql: string, params?: unknown[]): unknown[];
  export = alasql;
}
