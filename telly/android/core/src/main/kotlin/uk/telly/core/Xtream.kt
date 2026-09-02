package uk.telly.core

/** Builds the URLs an Xtream Codes panel expects. No networking in here. */
object Xtream {

    fun normaliseHost(input: String): String {
        var h = input.trim().trimEnd('/')
        if (h.isEmpty()) return ""
        if (!Regex("""^https?://""", RegexOption.IGNORE_CASE).containsMatchIn(h)) h = "http://$h"
        return h.replace(Regex("""/player_api\.php.*$""", RegexOption.IGNORE_CASE), "").trimEnd('/')
    }

    fun api(host: String, user: String, pass: String, action: String = ""): String {
        val base = normaliseHost(host) +
            "/player_api.php?username=" + enc(user) + "&password=" + enc(pass)
        return if (action.isEmpty()) base else "$base&action=$action"
    }

    fun streamUrl(host: String, user: String, pass: String, streamId: String, ext: String): String =
        normaliseHost(host) + "/live/" + enc(user) + "/" + enc(pass) + "/" + streamId + "." + ext

    private fun enc(s: String): String = java.net.URLEncoder.encode(s, "UTF-8").replace("+", "%20")
}
