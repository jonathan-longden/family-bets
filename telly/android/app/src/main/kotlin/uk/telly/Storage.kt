package uk.telly

import android.content.Context
import org.json.JSONObject

/** Where a playlist came from, so it can be reloaded next time. */
sealed class Source {
    data class Url(val url: String) : Source()
    data class File(val name: String) : Source()
    data class Xc(val host: String, val user: String, val pass: String) : Source()

    fun toJson(): String = when (this) {
        is Url -> JSONObject().put("type", "url").put("url", url).toString()
        is File -> JSONObject().put("type", "file").put("name", name).toString()
        is Xc -> JSONObject().put("type", "xtream").put("host", host)
            .put("user", user).put("pass", pass).toString()
    }

    fun label(): String = when (this) {
        is Url -> url
        is File -> name
        is Xc -> "Xtream · $host"
    }

    companion object {
        fun fromJson(s: String?): Source? {
            if (s.isNullOrBlank()) return null
            return try {
                val o = JSONObject(s)
                when (o.optString("type")) {
                    "url" -> Url(o.optString("url"))
                    "file" -> File(o.optString("name"))
                    "xtream" -> Xc(o.optString("host"), o.optString("user"), o.optString("pass"))
                    else -> null
                }
            } catch (e: Exception) { null }
        }
    }
}

/**
 * Plain SharedPreferences, plus the playlist text in a file of its own —
 * a large playlist has no business in a preferences XML.
 */
class Storage(private val ctx: Context) {

    private val prefs = ctx.getSharedPreferences("telly", Context.MODE_PRIVATE)
    private val cacheFile get() = java.io.File(ctx.filesDir, "playlist.m3u")

    var source: Source?
        get() = Source.fromJson(prefs.getString("source", null))
        set(v) = prefs.edit().putString("source", v?.toJson()).apply()

    var lastChannelId: String?
        get() = prefs.getString("last", null)
        set(v) = prefs.edit().putString("last", v).apply()

    var favourites: Set<String>
        get() = prefs.getStringSet("favs", emptySet()) ?: emptySet()
        set(v) = prefs.edit().putStringSet("favs", v).apply()

    fun cachePlaylist(text: String) = cacheFile.writeText(text)

    fun cachedPlaylist(): String? = if (cacheFile.exists()) cacheFile.readText() else null

    fun forget() {
        prefs.edit().clear().apply()
        cacheFile.delete()
    }
}
