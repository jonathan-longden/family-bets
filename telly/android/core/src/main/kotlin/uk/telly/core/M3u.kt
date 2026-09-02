package uk.telly.core

/** One playable channel, as the playlist describes it. */
data class Channel(
    val id: String,
    val number: Int,
    val name: String,
    val url: String,
    val logo: String,
    val group: String,
    val tvgId: String
) {
    val key: String get() = name.lowercase()
}

/** What a parsed playlist carries besides its channels. */
data class Playlist(
    val channels: List<Channel>,
    val epgUrl: String
)

object M3u {

    private val ATTR = Regex("""([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"""")
    private val URI = Regex("""^[a-zA-Z][a-zA-Z0-9+.-]*://""")

    private fun attrs(s: String): Map<String, String> =
        ATTR.findAll(s).associate { it.groupValues[1].lowercase() to it.groupValues[2] }

    /**
     * Split an #EXTINF payload into its attributes and its title, without
     * tripping over commas inside attribute values or channel names.
     */
    internal fun splitExtinf(payload: String): Pair<String, String> {
        var i = 0
        while (i < payload.length && (payload[i].isDigit() || payload[i] == '-' || payload[i] == '.')) i++
        var inQuotes = false
        while (i < payload.length) {
            val c = payload[i]
            if (c == '"') inQuotes = !inQuotes
            else if (c == ',' && !inQuotes) break
            i++
        }
        val attrText = payload.substring(0, minOf(i, payload.length))
        val title = if (i < payload.length) payload.substring(i + 1).trim() else ""
        return attrText to title
    }

    private fun safeName(url: String): String =
        url.substringBefore('?').substringAfterLast('/').ifEmpty { url }

    fun parse(text: String): Playlist {
        val channels = ArrayList<Channel>()
        val seen = HashSet<String>()
        var epgUrl = ""
        var pendingName = ""
        var pendingLogo = ""
        var pendingGroup = ""
        var pendingTvgId = ""
        var hasPending = false
        var extgrp = ""

        for (raw in text.lineSequence()) {
            val line = raw.trim()
            if (line.isEmpty()) continue

            if (line.startsWith("#EXTM3U")) {
                val a = attrs(line)
                epgUrl = a["url-tvg"] ?: a["x-tvg-url"] ?: ""
                continue
            }
            if (line.startsWith("#EXTINF:")) {
                val (attrText, title) = splitExtinf(line.substring(8))
                val a = attrs(attrText)
                pendingName = title.ifEmpty { a["tvg-name"] ?: "Unnamed channel" }
                pendingTvgId = a["tvg-id"] ?: ""
                pendingLogo = a["tvg-logo"] ?: ""
                pendingGroup = a["group-title"] ?: ""
                hasPending = true
                continue
            }
            if (line.startsWith("#EXTGRP:")) { extgrp = line.substring(8).trim(); continue }
            if (line.startsWith("#")) continue                 // #EXTVLCOPT, comments

            // A line that is not a URI is not a stream: real playlists carry
            // placeholders such as [NO PUBLIC STREAM] for channels with no feed.
            if (!URI.containsMatchIn(line)) {
                hasPending = false; extgrp = ""
                continue
            }

            val name = if (hasPending) pendingName else safeName(line)
            val group = (if (hasPending) pendingGroup else "").ifEmpty { extgrp.ifEmpty { "Ungrouped" } }
            val id = "$group|$line"
            if (seen.add(id)) {
                channels.add(
                    Channel(
                        id = id,
                        number = channels.size + 1,
                        name = name,
                        url = line,
                        logo = if (hasPending) pendingLogo else "",
                        group = group,
                        tvgId = if (hasPending) pendingTvgId else ""
                    )
                )
            }
            hasPending = false; extgrp = ""
        }
        return Playlist(channels, epgUrl)
    }

    /** Ordered category names, in the order the playlist introduces them. */
    fun groups(channels: List<Channel>): List<String> =
        LinkedHashSet(channels.map { it.group }).toList()
}
