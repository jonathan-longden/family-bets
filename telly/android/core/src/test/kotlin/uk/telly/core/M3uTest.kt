package uk.telly.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class M3uTest {

    private val playlist = """
        #EXTM3U url-tvg="http://example.org/epg.xml"
        #EXTINF:-1 tvg-id="bbc1.uk" tvg-logo="http://logo/bbc1.png" group-title="UK | Entertainment",BBC One HD
        http://server/live/u/p/1.m3u8
        #EXTINF:-1 tvg-id="" tvg-logo="" group-title="UK | Sport",Sky Sports Main Event, Live
        #EXTVLCOPT:http-user-agent=VLC/3.0
        http://server/live/u/p/2.m3u8
        #EXTINF:-1,No Attributes Channel
        #EXTGRP:News
        http://server/live/u/p/3.ts
        #EXTINF:-1 group-title="Films, Classics" tvg-id="c1",Casablanca
        http://server/vod/4.mp4
        #EXTINF:-1 tvg-id="dead.tv" group-title="Japan",NHK BSP4K
        [NO PUBLIC STREAM]
        #EXTINF:-1 group-title="Serbia",RTV 1
        rtmp://212.200.230.50:1935/RTV/rtv1
        http://server/bare/stream.m3u8
        #EXTINF:-1 tvg-id="bbc1.uk" group-title="UK | Entertainment",BBC One HD
        http://server/live/u/p/1.m3u8
    """.trimIndent()

    private val parsed = M3u.parse(playlist)

    @Test fun `reads the epg url from the header`() {
        assertEquals("http://example.org/epg.xml", parsed.epgUrl)
    }

    @Test fun `a comma in the channel name survives`() {
        val ch = parsed.channels.first { it.group == "UK | Sport" }
        assertEquals("Sky Sports Main Event, Live", ch.name)
    }

    @Test fun `a comma inside an attribute value survives`() {
        val ch = parsed.channels.first { it.name == "Casablanca" }
        assertEquals("Films, Classics", ch.group)
        assertEquals("c1", ch.tvgId)
    }

    @Test fun `EXTGRP supplies a group when group-title does not`() {
        assertEquals("News", parsed.channels.first { it.name == "No Attributes Channel" }.group)
    }

    @Test fun `EXTVLCOPT lines are not mistaken for streams`() {
        assertTrue(parsed.channels.none { it.url.startsWith("#") })
    }

    @Test fun `placeholder addresses are not offered as channels`() {
        assertTrue(parsed.channels.none { it.name == "NHK BSP4K" })
        assertTrue(parsed.channels.none { it.url.contains("NO PUBLIC") })
    }

    @Test fun `a stream with no EXTINF is still listed, named after its file`() {
        val ch = parsed.channels.first { it.url.endsWith("/bare/stream.m3u8") }
        assertEquals("stream.m3u8", ch.name)
        assertEquals("Ungrouped", ch.group)
    }

    @Test fun `the same stream in the same group is listed once`() {
        assertEquals(1, parsed.channels.count { it.url.endsWith("/1.m3u8") })
    }

    @Test fun `channel numbers are stable and start at one`() {
        assertEquals(listOf(1, 2, 3, 4, 5, 6), parsed.channels.map { it.number })
    }

    @Test fun `groups keep the order the playlist introduces them`() {
        assertEquals(
            listOf("UK | Entertainment", "UK | Sport", "News", "Films, Classics", "Serbia", "Ungrouped"),
            M3u.groups(parsed.channels)
        )
    }

    @Test fun `an empty playlist parses to nothing rather than throwing`() {
        assertEquals(0, M3u.parse("").channels.size)
        assertEquals(0, M3u.parse("#EXTM3U\n").channels.size)
    }

    @Test fun `duration variants do not eat the title`() {
        assertEquals("-1" to "Plain", M3u.splitExtinf("-1,Plain"))
        assertEquals("120 tvg-logo=\"l\"" to "T", M3u.splitExtinf("120 tvg-logo=\"l\",T"))
        assertEquals("-1" to "", M3u.splitExtinf("-1"))
    }
}

class StreamsTest {

    @Test fun `http and https are attempted`() {
        assertNull(Streams.refusal("http://server/live/1.m3u8"))
        assertNull(Streams.refusal("https://server/live/1.m3u8"))
    }

    @Test fun `plain http is fine here, unlike in a browser`() {
        // The whole point of the native app: no mixed-content rule.
        assertNull(Streams.refusal("http://panel.example.com:8080/live/u/p/101.m3u8"))
    }

    @Test fun `raw MPEG-TS is playable here, unlike in a browser`() {
        assertNull(Streams.refusal("http://panel.example.com:8080/live/u/p/101.ts"))
        assertTrue(!Streams.isHls("http://panel.example.com:8080/live/u/p/101.ts"))
    }

    @Test fun `rtmp and rtsp are refused with a reason`() {
        val r = Streams.refusal("rtmp://host/live/x")
        assertNotNull(r)
        assertTrue(r.contains("RTMP"))
        assertTrue(r.contains("VLC"))
        assertNotNull(Streams.refusal("rtsp://host/x"))
    }

    @Test fun `hls is recognised by extension and by xtream shape`() {
        assertTrue(Streams.isHls("http://s/live/u/p/1.m3u8"))
        assertTrue(Streams.isHls("http://s/live/u/p/1"))
        assertTrue(!Streams.isHls("http://s/vod/movie.mp4"))
    }
}

class XtreamTest {

    @Test fun `a bare host gains a scheme`() {
        assertEquals("http://example.com:8080", Xtream.normaliseHost("example.com:8080"))
    }

    @Test fun `a pasted player_api url is trimmed back to the host`() {
        assertEquals(
            "http://example.com:8080",
            Xtream.normaliseHost("http://example.com:8080/player_api.php?username=a&password=b")
        )
    }

    @Test fun `trailing slashes go`() {
        assertEquals("https://example.com", Xtream.normaliseHost("https://example.com///"))
    }

    @Test fun `credentials with awkward characters are encoded`() {
        val url = Xtream.streamUrl("http://h", "user name", "p@ss/word", "42", "m3u8")
        assertEquals("http://h/live/user%20name/p%40ss%2Fword/42.m3u8", url)
    }

    @Test fun `the api url carries the action`() {
        assertEquals(
            "http://h/player_api.php?username=u&password=p&action=get_live_streams",
            Xtream.api("http://h", "u", "p", "get_live_streams")
        )
    }
}
