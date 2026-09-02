package uk.telly.core.api

/** What the server says this account is and may do. */
data class Account(
    val id: Long,
    val username: String,
    val displayName: String,
    val role: String,
    val expiresAt: String?,
    val maxDevices: Int
) {
    val isAdmin: Boolean get() = role == "admin"
}

/** Which parts of the app to show. Absent means off. */
data class Sections(private val map: Map<String, Boolean>) {
    operator fun get(name: String): Boolean = map[name] == true
    val live get() = this["live"]
    val guide get() = this["guide"]
    val movies get() = this["movies"]
    val series get() = this["series"]
    val favourites get() = this["favourites"]
    val recent get() = this["recent"]
    val catchup get() = this["catchup"]
    val recordings get() = this["recordings"]
    val settings get() = this["settings"]
    val enabled: List<String> get() = map.filterValues { it }.keys.sorted()
}

data class PlaylistSummary(val id: Long, val name: String, val kind: String, val channelCount: Int, val lastSyncedAt: String?)

data class DeviceSummary(val id: Long, val name: String, val platform: String, val lastSeenAt: String?, val active: Boolean)

/** Everything the app needs to draw itself after signing in. */
data class Environment(
    val account: Account,
    val sections: Sections,
    val playlists: List<PlaylistSummary>,
    val devices: List<DeviceSummary>
)

data class Tokens(
    val accessToken: String,
    val refreshToken: String,
    val expiresIn: Int,
    val refreshExpiresIn: Int
) {
    /** Renew a little early rather than discovering expiry mid-request. */
    fun expiresAtMillis(now: Long = System.currentTimeMillis()): Long = now + (expiresIn - 30L).coerceAtLeast(0) * 1000
}

data class LoginResult(val tokens: Tokens, val environment: Environment)

data class Category(val name: String, val count: Int)

/** A channel as the server describes it: an id and a playback path, never a stream address. */
data class ServerChannel(
    val id: Long,
    val number: Int,
    val name: String,
    val group: String,
    val logo: String,
    val tvgId: String,
    val kind: String,
    val playbackPath: String
)

data class Page(val total: Int, val items: List<ServerChannel>)

data class Ticket(val url: String, val expiresIn: Int, val kind: String)

data class Health(val ok: Boolean, val service: String, val api: String, val configured: Boolean, val streamMode: String)
