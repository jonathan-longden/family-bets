package uk.telly

import uk.telly.core.Channel
import uk.telly.core.api.*

/**
 * The app's use of the backend, in one place.
 *
 * Everything here runs on a background thread — the callers use Dispatchers.IO
 * — and every failure arrives as an ApiException the screens turn into a
 * sentence rather than a status code.
 */
class ServerSession(private val store: ServerStore) {

    var environment: Environment? = null
        private set

    val endpoint: String? get() = store.endpoint

    private fun api(endpoint: String = store.endpoint.orEmpty()): TellyApi = TellyApi(endpoint, store)

    /** Is anything there, and is it ours? Used by the connect screen. */
    fun test(endpoint: String): Health = api(endpoint).health()

    fun signIn(endpoint: String, username: String, password: String): Environment {
        store.endpoint = endpoint
        val result = api().login(username, password, store.device())
        store.username = username
        environment = result.environment
        return result.environment
    }

    /** Resume without asking: the refresh token does the work if it still can. */
    fun resume(): Environment? {
        if (!store.isConfigured || !store.hasSession) return null
        return try {
            api().me().also { environment = it }
        } catch (e: ApiException) {
            if (e.needsSignIn) null else throw e
        }
    }

    fun signOut() {
        try { api().logout() } catch (e: Exception) { store.clear() }
        environment = null
    }

    /** The catalogue, as the same Channel type the direct playlists produce. */
    fun channels(kind: String = "live", group: String? = null, search: String? = null): List<Channel> =
        api().channels(kind = kind, group = group, search = search, limit = 2000).items.toChannels()

    fun categories(kind: String = "live"): List<Category> = api().categories(kind)

    fun favourites(): List<Channel> = api().favourites().toChannels()
    fun addFavourite(id: Long) = api().addFavourite(id)
    fun removeFavourite(id: Long) = api().removeFavourite(id)
    fun recent(): List<Channel> = api().recent().toChannels()

    /**
     * A playable address for one channel, valid for minutes. Fetched at the
     * moment of playing, never stored, so nothing on the device is worth
     * copying and the server can refuse at any time.
     */
    fun playbackUrl(channel: Channel): String {
        val id = channel.serverId ?: return channel.url
        return api().playbackUrl(id)
    }
}

/** One sentence per failure, written for somebody sitting across the room. */
fun ApiException.friendly(): String = when (failure) {
    ApiFailure.NO_SERVER ->
        "Cannot reach the server. Check it is switched on and that the address is right."
    ApiFailure.TIMEOUT ->
        "The server took too long to answer. It may be busy, or the network may be poor."
    ApiFailure.NOT_A_TELLY_SERVER ->
        "Something answered at that address, but it is not a Telly server."
    ApiFailure.INVALID_CREDENTIALS ->
        "That username and password do not match."
    ApiFailure.ACCOUNT_DISABLED ->
        "This account has been switched off. Ask whoever runs the server."
    ApiFailure.ACCOUNT_EXPIRED ->
        "This account has expired. Ask whoever runs the server."
    ApiFailure.DEVICE_LIMIT ->
        message   // the server names the number, so use its words
    ApiFailure.SESSION_EXPIRED ->
        "You have been signed out. Please sign in again."
    ApiFailure.FORBIDDEN ->
        "This account is not allowed to do that."
    ApiFailure.NOT_FOUND ->
        "That is no longer on the server."
    ApiFailure.RATE_LIMITED ->
        "Too many attempts. Wait a moment and try again."
    ApiFailure.UPSTREAM_FAILED ->
        "The server could not reach the IPTV provider. $message"
    ApiFailure.BAD_REQUEST, ApiFailure.SERVER_ERROR ->
        "The server had a problem. Try again in a moment."
}
