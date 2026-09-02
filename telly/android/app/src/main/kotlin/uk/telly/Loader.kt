package uk.telly

import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import uk.telly.core.Channel
import uk.telly.core.M3u
import uk.telly.core.Playlist
import uk.telly.core.Xtream
import java.util.concurrent.TimeUnit

/**
 * Fetching a playlist. No CORS, no mixed-content rule — the two things that
 * stop a browser doing this — but plenty of other ways to fail, each of
 * which gets said out loud rather than swallowed.
 */
object Loader {

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    class Failed(message: String) : Exception(message)

    private fun get(url: String): String {
        val req = Request.Builder()
            .url(url)
            .header("User-Agent", "Telly/1.0 (Android)")
            .build()
        try {
            client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) throw Failed("The server replied ${res.code} ${res.message}.")
                return res.body?.string() ?: throw Failed("The server sent an empty reply.")
            }
        } catch (e: Failed) {
            throw e
        } catch (e: Exception) {
            throw Failed("Could not reach that address: ${e.message ?: e.javaClass.simpleName}.")
        }
    }

    fun fromUrl(url: String): Playlist {
        val text = get(url)
        val p = M3u.parse(text)
        if (p.channels.isEmpty()) throw Failed("No channels in that playlist — is it really an M3U file?")
        return p
    }

    fun fromText(text: String): Playlist {
        val p = M3u.parse(text)
        if (p.channels.isEmpty()) throw Failed("No channels in that file — is it really an M3U playlist?")
        return p
    }

    /** Xtream Codes: sign in, then read the categories and the live streams. */
    fun fromXtream(host: String, user: String, pass: String, note: (String) -> Unit): Playlist {
        if (host.isBlank() || user.isBlank() || pass.isBlank())
            throw Failed("Server, username and password are all needed.")

        note("Signing in…")
        val info = JSONObject(get(Xtream.api(host, user, pass)))
        val userInfo = info.optJSONObject("user_info")
            ?: throw Failed("That server did not answer like an Xtream panel.")
        if (userInfo.optInt("auth", 0) == 0) throw Failed("The server rejected those credentials.")
        val status = userInfo.optString("status", "")
        if (status.isNotEmpty() && !status.equals("Active", true))
            throw Failed("That account is \"$status\", not active.")

        note("Fetching categories…")
        val catName = HashMap<String, String>()
        try {
            val cats = JSONArray(get(Xtream.api(host, user, pass, "get_live_categories")))
            for (i in 0 until cats.length()) {
                val c = cats.getJSONObject(i)
                catName[c.optString("category_id")] = c.optString("category_name", "Ungrouped")
            }
        } catch (e: Exception) { /* categories are a nicety, not a requirement */ }

        note("Fetching channels…")
        val streams = try {
            JSONArray(get(Xtream.api(host, user, pass, "get_live_streams")))
        } catch (e: Failed) {
            throw e
        } catch (e: Exception) {
            throw Failed("The server sent an unexpected channel list.")
        }

        val formats = userInfo.optJSONArray("allowed_output_formats")
        var ext = "m3u8"
        if (formats != null) {
            val list = (0 until formats.length()).map { formats.optString(it) }
            ext = if (list.contains("m3u8")) "m3u8" else list.firstOrNull() ?: "m3u8"
        }

        val channels = ArrayList<Channel>(streams.length())
        for (i in 0 until streams.length()) {
            val s = streams.getJSONObject(i)
            val id = s.optString("stream_id")
            val name = s.optString("name").ifEmpty { "Channel $id" }
            channels.add(
                Channel(
                    id = "xc|$id",
                    number = s.optInt("num", i + 1),
                    name = name,
                    url = Xtream.streamUrl(host, user, pass, id, ext),
                    logo = s.optString("stream_icon", ""),
                    group = catName[s.optString("category_id")] ?: "Ungrouped",
                    tvgId = s.optString("epg_channel_id", "")
                )
            )
        }
        if (channels.isEmpty()) throw Failed("The panel returned no live channels.")
        return Playlist(channels, "")
    }
}
