/**
 * Wire vocabulary shared by both halves of `dsh-plan-compact-execute`.
 *
 * The host half imports these values at runtime; the browser half can only
 * *type-import* them, because its artifact must stay a classic script with no
 * module edges. The literal strings are therefore repeated inside
 * `src/client.ts`, and `test-manifest.mjs` fails when the two faces drift.
 *
 * @module dsh-plan-compact-execute/protocol
 */
/** Package name; also the prefix of every endpoint and type symbol. */
export const PACKAGE_NAME = 'dsh-plan-compact-execute';
/** Cordis service key and wire namespace of the host half. */
export const SERVICE_KEY = 'planCompactExec';
/** Public remote method name. */
export const METHOD_NAME = 'compactBeforeExecute';
/** Canonical endpoint identity registered on both faces. */
export const ENDPOINT_ID = `${PACKAGE_NAME}#${SERVICE_KEY}/${METHOD_NAME}`;
/** Wire field carrying the reviewed session's identity. */
export const SESSION_ID_WIRE = 'sessionId';
/** Type symbol of the validated session identity. */
export const SESSION_ID_SYMBOL = `${PACKAGE_NAME}#SessionId`;
/** Type symbol of the remote method's business result. */
export const RESULT_SYMBOL = `${PACKAGE_NAME}#CompactBeforeExecuteResult`;
