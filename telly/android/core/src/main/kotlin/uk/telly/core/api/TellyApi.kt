package uk.telly.core.api

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit

/**
 * The client's whole view of the backend.
 *
 * The endpoint is a constructor argument and nothing else in the app knows an
 * address, so moving the server from a PC to a VPS is one setting.
 */
class TellyApi(
    baseUrl: String,
    private val session: SessionStore,
    private val client: OkHttpClient = defaultClient()
) {

    private val base: HttpUrl = normalise(baseUrl)
        ?: throw ApiException(ApiFailure.NO_SERVER, "That does not look like a server address.")

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()

        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .build()

        /**
         * Accepts what a person would actually type: "192.168.1.10:8443",
         * "http://pc.local", "https://tv.example.com/". Defaults to http for
         * a bare address, because the first server is usually a PC on a LAN.
         */
        fun normalise(input: String): HttpUrl? {
            var s = input.trim().trimEnd('/')
            if (s.isEmpty()) return null
            if (!s.startsWith("http://", true) && !s.startsWith("https://", true)) s = "http://$s"
            return s.toHttpUrlOrNull()
        }
    }

    private fun url(vararg segments: String, query: Map<String, String?> = emptyMap()): HttpUrl {
        val b = base.newBuilder().addPathSegment("api").addPathSegment("v1")
        segments.forEach { b.addPathSegment(it) }
        query.forEach { (k, v) -> if (!v.isNullOrEmpty()) b.addQueryParameter(k, v) }
        return b.build()
    }

    /** The one place a network call is made, so every failure is named once. */
    private fun call(request: Request, authenticated: Boolean, retryOnExpiry: Boolean = true): JSONObject {
        val builder = request.newBuilder().header("accept", "application/json")
        if (authenticated) {
            val token = session.accessToken()
                ?: throw ApiException(ApiFailure.SESSION_EXPIRED, "Please sign in again.")
            builder.header("authorization", "Bearer $token")
        }

        val response = try {
            client.newCall(builder.build()).execute()
        } catch (e: SocketTimeoutException) {
            throw ApiException(ApiFailure.TIMEOUT, "The server did not answer in time.", cause = e)
        } catch (e: IOException) {
            throw ApiException(ApiFailure.NO_SERVER, "Could not reach the server. Check the address and that it is running.", cause = e)
        }

        response.use {
            val body = it.body?.string().orEmpty()
            if (it.isSuccessful) {
                if (body.isBlank()) return JSONObject()
                return try { JSONObject(body) } catch (e: Exception) {
                    throw ApiException(ApiFailure.NOT_A_TELLY_SERVER, "That address answered, but not like a Telly server.")
                }
            }

            val error = try { JSONObject(body).optJSONObject("error") } catch (e: Exception) { null }
                ?: throw ApiException(
                    if (it.code == 404) ApiFailure.NOT_A_TELLY_SERVER else ApiFailure.SERVER_ERROR,
                    if (it.code == 404) "That address answered, but not like a Telly server."
                    else "The server had a problem (${it.code})."
                )

            val api = ApiException.fromCode(
                error.optString("code"), error.optString("message"), error.optString("detail").ifEmpty { null }
            )

            // One silent retry after refreshing, so a session that lapsed while
            // the television was asleep does not become a login screen.
            if (api.failure == ApiFailure.SESSION_EXPIRED && authenticated && retryOnExpiry && session.canRefresh()) {
                refresh()
                return call(request, authenticated = true, retryOnExpiry = false)
            }
            throw api
        }
    }

    private fun post(u: HttpUrl, json: JSONObject?, authenticated: Boolean): JSONObject =
        call(Request.Builder().url(u).post((json ?: JSONObject()).toString().toRequestBody(JSON)).build(), authenticated)

    private fun get(u: HttpUrl, authenticated: Boolean = true): JSONObject =
        call(Request.Builder().url(u).get().build(), authenticated)

    private fun delete(u: HttpUrl): JSONObject =
        call(Request.Builder().url(u).delete().build(), true)

    private fun put(u: HttpUrl, json: JSONObject? = null): JSONObject =
        call(Request.Builder().url(u).put((json ?: JSONObject()).toString().toRequestBody(JSON)).build(), true)

    // ---------------------------------------------------------------- health

    /** For the connect screen's "test connection": is anyone there, and is it us? */
    fun health(): Health {
        val o = get(url("health"), authenticated = false)
        if (!o.has("service") || o.optString("service") != "telly")
            throw ApiException(ApiFailure.NOT_A_TELLY_SERVER, "That address answered, but not like a Telly server.")
        return Health(
            ok = o.optBoolean("ok"),
            service = o.optString("service"),
            api = o.optString("api"),
            configured = o.optBoolean("configured"),
            streamMode = o.optString("streamMode")
        )
    }

    // ------------------------------------------------------------------ auth

    fun login(username: String, password: String, device: DeviceIdentity): LoginResult {
        val body = JSONObject()
            .put("username", username)
            .put("password", password)
            .put("device", JSONObject()
                .put("key", device.key)
                .put("name", device.name)
                .put("platform", device.platform)
                .put("appVersion", device.appVersion))
        val o = post(url("auth", "login"), body, authenticated = false)
        val result = LoginResult(tokens(o), environment(o))
        session.save(result.tokens)
        return result
    }

    fun refresh(): Tokens {
        val refresh = session.refreshToken()
            ?: throw ApiException(ApiFailure.SESSION_EXPIRED, "Please sign in again.")
        val o = try {
            post(url("auth", "refresh"), JSONObject().put("refreshToken", refresh), authenticated = false)
        } catch (e: ApiException) {
            if (e.failure == ApiFailure.SESSION_EXPIRED) session.clear()
            throw e
        }
        val t = tokens(o)
        session.save(t)
        return t
    }

    fun logout() {
        try { post(url("auth", "logout"), null, authenticated = true) } catch (e: ApiException) { /* going anyway */ }
        session.clear()
    }

    fun me(): Environment = environment(get(url("me")))

    // --------------------------------------------------------------- library

    fun categories(kind: String = "live"): List<Category> {
        val arr = get(url("categories", query = mapOf("kind" to kind))).optJSONArray("categories") ?: JSONArray()
        return (0 until arr.length()).map {
            val o = arr.getJSONObject(it)
            Category(o.optString("name"), o.optInt("count"))
        }
    }

    fun channels(
        kind: String = "live",
        group: String? = null,
        search: String? = null,
        limit: Int = 500,
        offset: Int = 0
    ): Page {
        val o = get(url("channels", query = mapOf(
            "kind" to kind, "group" to group, "search" to search,
            "limit" to limit.toString(), "offset" to offset.toString()
        )))
        return Page(o.optInt("total"), channelList(o.optJSONArray("items")))
    }

    fun favourites(): List<ServerChannel> = channelList(get(url("me", "favourites")).optJSONArray("channels"))
    fun addFavourite(channelId: Long) { put(url("me", "favourites", channelId.toString())) }
    fun removeFavourite(channelId: Long) { delete(url("me", "favourites", channelId.toString())) }
    fun recent(): List<ServerChannel> = channelList(get(url("me", "recent")).optJSONArray("channels"))

    fun devices(): List<DeviceSummary> = deviceList(get(url("me", "devices")).optJSONArray("devices"))
    fun removeDevice(id: Long) { delete(url("me", "devices", id.toString())) }

    /**
     * A playable, absolute URL for the player. The credentials stay on the
     * server; this is a signed ticket that expires in minutes.
     */
    fun playbackUrl(channelId: Long): String {
        val o = post(url("stream", channelId.toString(), "ticket"), null, authenticated = true)
        val path = o.optString("url")
        if (path.isEmpty()) throw ApiException(ApiFailure.SERVER_ERROR, "The server did not return a playable link.")
        return base.newBuilder().encodedPath("/").build().toString().trimEnd('/') + path
    }

    // ---------------------------------------------------------------- mapping

    private fun tokens(o: JSONObject) = Tokens(
        accessToken = o.optString("accessToken"),
        refreshToken = o.optString("refreshToken"),
        expiresIn = o.optInt("expiresIn", 1800),
        refreshExpiresIn = o.optInt("refreshExpiresIn", 2592000)
    )

    private fun environment(o: JSONObject): Environment {
        val u = o.optJSONObject("user") ?: JSONObject()
        val s = o.optJSONObject("sections") ?: JSONObject()
        val sections = HashMap<String, Boolean>()
        for (key in s.keys()) sections[key] = s.optBoolean(key)
        return Environment(
            account = Account(
                id = u.optLong("id"),
                username = u.optString("username"),
                displayName = u.optString("displayName").ifEmpty { u.optString("username") },
                role = u.optString("role", "user"),
                expiresAt = u.optString("expiresAt").ifEmpty { null },
                maxDevices = u.optInt("maxDevices", 1)
            ),
            sections = Sections(sections),
            playlists = (o.optJSONArray("playlists") ?: JSONArray()).let { arr ->
                (0 until arr.length()).map {
                    val p = arr.getJSONObject(it)
                    PlaylistSummary(p.optLong("id"), p.optString("name"), p.optString("kind"),
                        p.optInt("channelCount"), p.optString("lastSyncedAt").ifEmpty { null })
                }
            },
            devices = deviceList(o.optJSONArray("devices"))
        )
    }

    private fun channelList(arr: JSONArray?): List<ServerChannel> {
        val a = arr ?: return emptyList()
        return (0 until a.length()).map {
            val c = a.getJSONObject(it)
            ServerChannel(
                id = c.optLong("id"),
                number = c.optInt("number"),
                name = c.optString("name"),
                group = c.optString("group"),
                logo = c.optString("logo"),
                tvgId = c.optString("tvgId"),
                kind = c.optString("kind", "live"),
                playbackPath = c.optString("playback")
            )
        }
    }

    private fun deviceList(arr: JSONArray?): List<DeviceSummary> {
        val a = arr ?: return emptyList()
        return (0 until a.length()).map {
            val d = a.getJSONObject(it)
            DeviceSummary(d.optLong("id"), d.optString("name"), d.optString("platform"),
                d.optString("lastSeenAt").ifEmpty { null }, d.optBoolean("active", true))
        }
    }
}

/** How this install identifies itself. The key is made once and kept. */
data class DeviceIdentity(
    val key: String,
    val name: String,
    val platform: String = "android",
    val appVersion: String = "1.0"
)
