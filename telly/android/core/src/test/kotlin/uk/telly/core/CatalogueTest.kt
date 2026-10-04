package uk.telly.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.assertNotNull

class CatalogueTest {

    @Test
    fun `every entry is complete`() {
        for (e in Catalogue.entries) {
            assertTrue(e.group.isNotBlank(), "blank group: ${e.url}")
            assertTrue(e.name.isNotBlank(), "blank name: ${e.url}")
            assertTrue(e.detail.isNotBlank(), "blank detail: ${e.url}")
            assertTrue(e.url.startsWith("https://"), "not https: ${e.url}")
        }
    }

    @Test
    fun `no duplicate urls`() {
        val urls = Catalogue.entries.map { it.url }
        assertEquals(urls.size, urls.distinct().size, "duplicate playlist URLs in the catalogue")
    }

    @Test
    fun `each group is one unbroken run, so headers are not repeated`() {
        val seen = mutableListOf<String>()
        var last: String? = null
        for (e in Catalogue.entries) {
            if (e.group != last) {
                assertTrue(e.group !in seen, "group '${e.group}' appears in two separate runs")
                seen += e.group
                last = e.group
            }
        }
        assertEquals(seen, Catalogue.groups())
    }

    @Test
    fun `the Free-TV splits are all there`() {
        val ftv = Catalogue.entries.filter {
            it.url.startsWith("https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_")
        }
        // 87 country lists plus 8 topical ones, as published under playlists/.
        assertEquals(95, ftv.size)
        assertEquals(87, ftv.count { it.group == "Free-TV — by country" })
        assertEquals(8, ftv.count { it.group == "Free-TV — by topic" })
    }

    @Test
    fun `the film channels list is reachable by name and by search`() {
        val movies = Catalogue.entries.find {
            it.url.endsWith("playlists/playlist_zz_movies.m3u8")
        }
        assertNotNull(movies, "the Free-TV film channels playlist is missing")
        assertEquals("Film channels", movies.name)
        assertTrue(Catalogue.search("film").contains(movies))
        assertTrue(Catalogue.search("FILM").contains(movies), "search should ignore case")
    }

    @Test
    fun `search matches name, group and description`() {
        assertTrue(Catalogue.search("ukraine").any { it.name == "Ukraine" })
        assertTrue(Catalogue.search("Free-TV").size >= 95, "group names should be searchable")
        assertTrue(Catalogue.search("rolling news").any { it.name.startsWith("News") })
    }

    @Test
    fun `a blank query returns the whole table`() {
        assertEquals(Catalogue.entries, Catalogue.search(""))
        assertEquals(Catalogue.entries, Catalogue.search("   "))
    }

    @Test
    fun `a query that matches nothing returns empty rather than everything`() {
        assertTrue(Catalogue.search("zzzznosuchthing").isEmpty())
    }

    @Test
    fun `inGroup agrees with the table`() {
        for (g in Catalogue.groups()) {
            val rows = Catalogue.inGroup(g)
            assertTrue(rows.isNotEmpty(), "empty group: $g")
            assertTrue(rows.all { it.group == g })
        }
        assertEquals(Catalogue.entries.size, Catalogue.groups().sumOf { Catalogue.inGroup(it).size })
    }

    @Test
    fun `every url parses as a playlist address the loader will accept`() {
        for (e in Catalogue.entries) {
            assertEquals("https", Streams.scheme(e.url), e.url)
            assertEquals(null, Streams.refusal(e.url), "${e.url} would be refused before loading")
        }
    }
}
