package uk.telly.core.api

/**
 * Where the tokens live. The app implements this over encrypted preferences;
 * the tests use the in-memory one below. Keeping it an interface is what lets
 * the API client be tested without Android.
 */
interface SessionStore {
    fun accessToken(): String?
    fun refreshToken(): String?
    fun save(tokens: Tokens)
    fun clear()
    fun canRefresh(): Boolean = refreshToken() != null
}

class InMemorySession(
    private var access: String? = null,
    private var refresh: String? = null
) : SessionStore {
    override fun accessToken() = access
    override fun refreshToken() = refresh
    override fun save(tokens: Tokens) { access = tokens.accessToken; refresh = tokens.refreshToken }
    override fun clear() { access = null; refresh = null }
}
