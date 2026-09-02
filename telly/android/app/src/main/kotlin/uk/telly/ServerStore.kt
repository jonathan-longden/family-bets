package uk.telly

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import uk.telly.core.api.DeviceIdentity
import uk.telly.core.api.SessionStore
import uk.telly.core.api.Tokens
import java.util.UUID

/**
 * The server side of the app's memory: which server, who is signed in, and
 * which device this install claims to be.
 *
 * The endpoint is a setting from the very first run — nothing in the app has an
 * address compiled into it — so moving the backend from a PC to a VPS is a
 * change on this screen and nowhere else.
 */
class ServerStore(context: Context) : SessionStore {

    private val prefs: SharedPreferences = try {
        val key = MasterKey.Builder(context, MasterKey.DEFAULT_MASTER_KEY_ALIAS)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context, "telly-server", key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    } catch (e: Exception) {
        // Some devices, particularly older TV boxes, have a keystore that will
        // not play. Working in the clear beats refusing to start; the README
        // says so rather than leaving it as a surprise.
        context.getSharedPreferences("telly-server-plain", Context.MODE_PRIVATE)
    }

    var endpoint: String?
        get() = prefs.getString("endpoint", null)
        set(v) = prefs.edit().putString("endpoint", v?.trim()?.trimEnd('/')).apply()

    /** Server mode is only on when there is somewhere to talk to. */
    val isConfigured: Boolean get() = !endpoint.isNullOrBlank()

    var username: String?
        get() = prefs.getString("username", null)
        set(v) = prefs.edit().putString("username", v).apply()

    override fun accessToken(): String? = prefs.getString("access", null)
    override fun refreshToken(): String? = prefs.getString("refresh", null)

    override fun save(tokens: Tokens) {
        prefs.edit()
            .putString("access", tokens.accessToken)
            .putString("refresh", tokens.refreshToken)
            .putLong("accessExpiresAt", tokens.expiresAtMillis())
            .apply()
    }

    override fun clear() {
        prefs.edit().remove("access").remove("refresh").remove("accessExpiresAt").apply()
    }

    /** Signed in as far as this device knows; the server has the final say. */
    val hasSession: Boolean get() = !refreshToken().isNullOrBlank()

    /** Made once, kept for the life of the install: this is "the bedroom TV". */
    fun device(): DeviceIdentity {
        var key = prefs.getString("deviceKey", null)
        if (key.isNullOrBlank()) {
            key = UUID.randomUUID().toString()
            prefs.edit().putString("deviceKey", key).apply()
        }
        val name = prefs.getString("deviceName", null) ?: defaultDeviceName()
        return DeviceIdentity(key = key, name = name, platform = platform(), appVersion = "1.0")
    }

    fun setDeviceName(name: String) = prefs.edit().putString("deviceName", name).apply()

    private fun defaultDeviceName(): String {
        val model = listOfNotNull(Build.MANUFACTURER, Build.MODEL)
            .joinToString(" ") { it.trim() }
            .trim()
        return if (model.isBlank()) "Android device" else model.take(48)
    }

    private fun platform(): String = when {
        Build.MODEL.contains("AFT", true) -> "firetv"
        else -> "android"
    }

    fun forgetServer() {
        prefs.edit().clear().apply()
    }
}
