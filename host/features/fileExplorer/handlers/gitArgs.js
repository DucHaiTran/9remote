// Checks for values a client hands to git. They reach git as argv, never a shell, so these
// only keep a value from parsing as an option or as something other than what it claims.
const HASH_RE = /^[0-9a-f]{4,64}$/i;
const REMOTE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const MAX_URL_LENGTH = 2048;

export const isHash = (v) => typeof v === "string" && HASH_RE.test(v);

export const isRefName = (v) => typeof v === "string" && v.length > 0 && v.length < 256 && !v.startsWith("-") && !/[\s~^:?*[\\\x00-\x1f]/.test(v) && !v.includes("..");

export const isRemoteName = (v) => typeof v === "string" && REMOTE_NAME_RE.test(v);

// Any transport git itself allows (https, ssh, scp-style, a path); git's own protocol policy
// still refuses the dangerous ones. Only an option-looking or multi-line value is turned away.
export const isRemoteUrl = (v) => typeof v === "string" && v.length > 0 && v.length <= MAX_URL_LENGTH && !v.startsWith("-") && !/[\x00-\x1f\s]/.test(v);
