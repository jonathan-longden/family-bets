package uk.telly.core

import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import uk.telly.core.api.*
import kotlin.test.*

/**
 * The API client against a real HTTP server. Every failure the app has to
 * survive is provoked here rather than imagined.
 */
class ApiTest {

    private lateinit var server: MockWebServer
    private lateinit var session: InMemorySession
    private lateinit var api: TellyApi

    private val device = DeviceIdentity(key = "device-key-000001", name = "Living Room TV", platform = "androidtv")

    @BeforeTest fun start() {
        server = MockWebServer()
        server.start()
        session = InMemorySession()
        api = TellyApi(server.url("/").toString(), session)
    }

    @AfterTest fun stop() = server.shutdown()

    private fun json(code: Int, body: String) =
        MockResponse().setResponseCode(code).setHeader("content-type", "application/json").setBody(body)

    private fun error(code: Int, apiCode: String, message: String) =
        json(code, """{"error":{"code":"$apiCode","message":"$message"}}""")

    @Test fun `the endpoint accepts what a person would type`() {
        assertEquals("http://192.168.1.10:8443/", TellyApi.normalise("192.168.1.10:8443").toString())
        assertEquals("http://pc.local/", TellyApi.normalise("  pc.local/  ").toString())
        assertEquals("https://tv.example.com/", TellyApi.normalise("https://tv.example.com").toString())
        assertNull(TellyApi.normalise(""))
    }

    @Test fun `health confirms it is a Telly server`() {
        server.enqueue(json(200, """{"ok":true,"service":"telly","api":"v1","configured":true,"streamMode":"redirect"}"""))
        val h = api.health()
        assertTrue(h.ok)
        assertTrue(h.configured)
        assertEquals("/api/v1/health", server.takeRequest().path)
    }

    @Test fun `something else answering on that port is not mistaken for the server`() {
        server.enqueue(json(200, """{"hello":"i am a router"}"""))
        val e = assertFailsWith<ApiException> { api.health() }
        assertEquals(ApiFailure.NOT_A_TELLY_SERVER, e.failure)
    }

    @Test fun `a 404 from some other web server is named as such`() {
        server.enqueue(MockResponse().setResponseCode(404).setBody("<html>nginx</html>"))
        val e = assertFailsWith<ApiException> { api.health() }
        assertEquals(ApiFailure.NOT_A_TELLY_SERVER, e.failure)
    }

    @Test fun `nothing listening is a clear failure, not a crash`() {
        val dead = TellyApi("http://127.0.0.1:1", InMemorySession())
        val e = assertFailsWith<ApiException> { dead.health() }
        assertEquals(ApiFailure.NO_SERVER, e.failure)
        assertTrue(e.message.contains("Could not reach"))
    }

    @Test fun `signing in keeps the tokens and returns the environment`() {
        server.enqueue(json(200, """{
          "accessToken":"access-1","refreshToken":"refresh-1","expiresIn":1800,"refreshExpiresIn":2592000,
          "user":{"id":2,"username":"john","displayName":"John","role":"user","expiresAt":null,"maxDevices":2},
          "sections":{"live":true,"guide":true,"movies":true,"series":false,"favourites":true,"recent":true,"catchup":false,"recordings":false,"settings":true},
          "playlists":[{"id":1,"name":"House","kind":"m3u_url","channelCount":2038,"lastSyncedAt":"2026-01-01T00:00:00Z"}],
          "devices":[{"id":1,"name":"Living Room TV","platform":"androidtv","lastSeenAt":null,"active":true}]}"""))

        val result = api.login("john", "johnspassword", device)
        assertEquals("john", result.environment.account.username)
        assertEquals(2, result.environment.account.maxDevices)
        assertTrue(result.environment.sections.live)
        assertFalse(result.environment.sections.series)
        assertEquals(listOf("favourites", "guide", "live", "movies", "recent", "settings"), result.environment.sections.enabled)
        assertEquals(2038, result.environment.playlists.first().channelCount)
        assertEquals("access-1", session.accessToken())

        val sent = server.takeRequest()
        assertEquals("/api/v1/auth/login", sent.path)
        val body = sent.body.readUtf8()
        assertTrue(body.contains("device-key-000001"), "the device identifies itself")
        assertTrue(body.contains("androidtv"))
    }

    @Test fun `each failure the server can report becomes a named one here`() {
        val cases = listOf(
            Triple(401, "invalid_credentials", ApiFailure.INVALID_CREDENTIALS),
            Triple(403, "account_disabled", ApiFailure.ACCOUNT_DISABLED),
            Triple(403, "account_expired", ApiFailure.ACCOUNT_EXPIRED),
            Triple(409, "device_limit", ApiFailure.DEVICE_LIMIT),
            Triple(429, "rate_limited", ApiFailure.RATE_LIMITED),
            Triple(400, "bad_request", ApiFailure.BAD_REQUEST)
        )
        for ((status, code, expected) in cases) {
            server.enqueue(error(status, code, "Something a person can read."))
            val e = assertFailsWith<ApiException> { api.login("john", "nope", device) }
            assertEquals(expected, e.failure, "status $status/$code")
            assertEquals("Something a person can read.", e.message)
        }
    }

    @Test fun `a lapsed session is refreshed once, silently, and the call goes through`() {
        session.save(Tokens("stale-access", "good-refresh", 1800, 2592000))
        server.enqueue(error(401, "session_expired", "Your session has expired."))
        server.enqueue(json(200, """{"accessToken":"fresh-access","refreshToken":"fresh-refresh","expiresIn":1800,"refreshExpiresIn":2592000}"""))
        server.enqueue(json(200, """{"total":1,"items":[{"id":7,"number":1,"name":"BBC One","group":"UK","logo":"","tvgId":"","kind":"live","playback":"/api/v1/stream/7"}]}"""))

        val page = api.channels()
        assertEquals(1, page.total)
        assertEquals("fresh-access", session.accessToken(), "the new token was kept")

        assertEquals("/api/v1/channels?kind=live&limit=500&offset=0", server.takeRequest().path)
        assertEquals("/api/v1/auth/refresh", server.takeRequest().path)
        val retried = server.takeRequest()
        assertEquals("Bearer fresh-access", retried.getHeader("authorization"), "the retry used the new token")
    }

    @Test fun `a refresh that is itself refused clears the session and asks for a sign-in`() {
        session.save(Tokens("stale-access", "dead-refresh", 1800, 2592000))
        server.enqueue(error(401, "session_expired", "Your session has expired."))
        server.enqueue(error(401, "session_expired", "Your session has expired."))

        val e = assertFailsWith<ApiException> { api.channels() }
        assertEquals(ApiFailure.SESSION_EXPIRED, e.failure)
        assertTrue(e.needsSignIn)
        assertNull(session.accessToken(), "the dead session was thrown away")
    }

    @Test fun `the refresh is attempted once and not in a loop`() {
        session.save(Tokens("a", "b", 1800, 2592000))
        server.enqueue(error(401, "session_expired", "gone"))
        server.enqueue(json(200, """{"accessToken":"c","refreshToken":"d","expiresIn":1800,"refreshExpiresIn":1}"""))
        server.enqueue(error(401, "session_expired", "still gone"))

        assertFailsWith<ApiException> { api.channels() }
        assertEquals(3, server.requestCount, "one call, one refresh, one retry — then it gives up")
    }

    @Test fun `channels come back without a stream address anywhere`() {
        session.save(Tokens("access", "refresh", 1800, 2592000))
        server.enqueue(json(200, """{"total":2,"items":[
          {"id":7,"number":1,"name":"BBC One","group":"UK","logo":"http://l/1.png","tvgId":"bbc1","kind":"live","playback":"/api/v1/stream/7"},
          {"id":9,"number":2,"name":"Casablanca","group":"Movies","logo":"","tvgId":"","kind":"movie","playback":"/api/v1/stream/9"}]}"""))
        val page = api.channels(kind = "live", search = "bbc")
        assertEquals(2, page.total)
        assertEquals("/api/v1/stream/7", page.items[0].playbackPath)
        assertEquals("movie", page.items[1].kind)
        val path = server.takeRequest().path!!
        assertTrue(path.contains("search=bbc"))
    }

    @Test fun `a playback URL is absolute, so the player can simply open it`() {
        session.save(Tokens("access", "refresh", 1800, 2592000))
        server.enqueue(json(200, """{"url":"/api/v1/stream/7?ticket=abc.def","expiresIn":300,"kind":"live"}"""))
        val url = api.playbackUrl(7)
        assertTrue(url.startsWith(server.url("/").toString().trimEnd('/')))
        assertTrue(url.endsWith("/api/v1/stream/7?ticket=abc.def"))
        assertEquals("POST", server.takeRequest().method)
    }

    @Test fun `signing out forgets the tokens even if the server never hears about it`() {
        session.save(Tokens("access", "refresh", 1800, 2592000))
        server.enqueue(MockResponse().setResponseCode(500))
        api.logout()
        assertNull(session.accessToken())
        assertNull(session.refreshToken())
    }

    @Test fun `a request with no session does not pretend to be authenticated`() {
        val e = assertFailsWith<ApiException> { api.channels() }
        assertEquals(ApiFailure.SESSION_EXPIRED, e.failure)
        assertEquals(0, server.requestCount, "nothing was sent without a token")
    }
}

class MappingTest {
    @Test fun `a server channel becomes the same shape the screens already use`() {
        val sc = ServerChannel(
            id = 1608, number = 12, name = "BBC One", group = "UK",
            logo = "http://l/1.png", tvgId = "bbc1.uk", kind = "live", playbackPath = "/api/v1/stream/1608"
        )
        val ch = sc.toChannel()
        assertEquals("srv:1608", ch.id)
        assertEquals("BBC One", ch.name)
        assertEquals(1608L, ch.serverId)
        assertTrue(ch.needsTicket)
        assertEquals("", ch.url, "a server channel never carries an address on the device")
    }

    @Test fun `a playlist channel is unchanged and needs no ticket`() {
        val ch = uk.telly.core.M3u.parse(
            "#EXTM3U\n#EXTINF:-1 group-title=\"UK\",BBC One\nhttp://x/1.m3u8\n"
        ).channels.first()
        assertNull(ch.serverId)
        assertFalse(ch.needsTicket)
        assertEquals("http://x/1.m3u8", ch.url)
    }

    @Test fun `an empty group from the server does not become a blank heading`() {
        assertEquals("Ungrouped", ServerChannel(1, 1, "X", "", "", "", "live", "/p").toChannel().group)
    }
}
