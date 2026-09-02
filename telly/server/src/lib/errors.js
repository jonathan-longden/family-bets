/**
 * One error shape for the whole API, so a client can act on `code` and show
 * `message` to a person without ever printing a stack trace on a television.
 */
export class ApiError extends Error {
  constructor(status, code, message, detail) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
  toJSON() {
    return { error: { code: this.code, message: this.message, ...(this.detail ? { detail: this.detail } : {}) } };
  }
}

export const badRequest = (m, d) => new ApiError(400, 'bad_request', m, d);
export const invalidCredentials = () => new ApiError(401, 'invalid_credentials', 'That username and password do not match.');
export const sessionExpired = () => new ApiError(401, 'session_expired', 'Your session has expired. Please sign in again.');
export const forbidden = (m = 'You are not allowed to do that.') => new ApiError(403, 'forbidden', m);
export const accountDisabled = () => new ApiError(403, 'account_disabled', 'This account has been disabled. Contact whoever runs the server.');
export const accountExpired = () => new ApiError(403, 'account_expired', 'This account has expired. Contact whoever runs the server.');
export const deviceLimit = (max) => new ApiError(409, 'device_limit', `This account is already signed in on ${max} device${max === 1 ? '' : 's'}. Remove one to add another.`);
export const notFound = (m = 'Not found.') => new ApiError(404, 'not_found', m);
export const upstreamFailed = (m) => new ApiError(502, 'upstream_failed', m);
