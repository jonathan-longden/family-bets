package uk.telly.core.api

/**
 * Every failure the app can meet, named rather than described, so the screens
 * can decide what to do and a person is never shown a status code.
 */
enum class ApiFailure {
    NO_SERVER,          // wrong address, server not running, no network
    TIMEOUT,
    INVALID_CREDENTIALS,
    ACCOUNT_DISABLED,
    ACCOUNT_EXPIRED,
    DEVICE_LIMIT,
    SESSION_EXPIRED,
    FORBIDDEN,
    NOT_FOUND,
    RATE_LIMITED,
    BAD_REQUEST,
    UPSTREAM_FAILED,    // the IPTV provider, not us
    SERVER_ERROR,
    NOT_A_TELLY_SERVER
}

class ApiException(
    val failure: ApiFailure,
    override val message: String,
    val detail: String? = null,
    cause: Throwable? = null
) : Exception(message, cause) {

    /** True when signing in again is the way out. */
    val needsSignIn: Boolean
        get() = failure == ApiFailure.SESSION_EXPIRED ||
                failure == ApiFailure.INVALID_CREDENTIALS

    companion object {
        fun fromCode(code: String, message: String, detail: String? = null): ApiException {
            val failure = when (code) {
                "invalid_credentials" -> ApiFailure.INVALID_CREDENTIALS
                "account_disabled" -> ApiFailure.ACCOUNT_DISABLED
                "account_expired" -> ApiFailure.ACCOUNT_EXPIRED
                "device_limit" -> ApiFailure.DEVICE_LIMIT
                "session_expired" -> ApiFailure.SESSION_EXPIRED
                "forbidden" -> ApiFailure.FORBIDDEN
                "not_found" -> ApiFailure.NOT_FOUND
                "rate_limited" -> ApiFailure.RATE_LIMITED
                "bad_request" -> ApiFailure.BAD_REQUEST
                "upstream_failed" -> ApiFailure.UPSTREAM_FAILED
                else -> ApiFailure.SERVER_ERROR
            }
            return ApiException(failure, message, detail)
        }
    }
}
