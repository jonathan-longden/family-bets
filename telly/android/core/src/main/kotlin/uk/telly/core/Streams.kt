package uk.telly.core

/**
 * What a player can and cannot do with a stream address.
 *
 * A browser refuses http:// on an https:// page and cannot decode raw
 * MPEG-TS. ExoPlayer has neither limit, which is the whole reason this
 * app exists; rtmp and rtsp remain out of reach without extra libraries.
 */
object Streams {

    fun scheme(url: String): String =
        Regex("""^([a-zA-Z][a-zA-Z0-9+.-]*)://""").find(url)?.groupValues?.get(1)?.lowercase() ?: ""

    fun isHls(url: String): Boolean {
        val u = url.substringBefore('#')
        if (Regex("""\.m3u8($|\?)""", RegexOption.IGNORE_CASE).containsMatchIn(u)) return true
        if (Regex("""\.(ts|mp4|mkv|avi|flv)($|\?)""", RegexOption.IGNORE_CASE).containsMatchIn(u)) return false
        return Regex("""/(live|hls)/""", RegexOption.IGNORE_CASE).containsMatchIn(u)
    }

    /** null when the app can attempt it; otherwise why it cannot. */
    fun refusal(url: String): String? = when (scheme(url)) {
        "http", "https" -> null
        "" -> "This channel has no stream address in the playlist."
        "rtmp", "rtmps", "rtsp" ->
            "This is an ${scheme(url).uppercase()} stream. Telly plays http and https; VLC can open this one."
        else ->
            "Telly cannot play ${scheme(url)}:// streams."
    }
}
