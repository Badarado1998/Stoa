/** JSON for a <script type="application/ld+json"> block: "<", ">" and "&" escaped, so text anyone picks (a token's
 *  symbol, a candidate's name) can never close the script and run as code. */
export const ldJson = (v: unknown): string =>
  JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
