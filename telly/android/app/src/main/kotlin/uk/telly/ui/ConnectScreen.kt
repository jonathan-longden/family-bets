package uk.telly.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import uk.telly.core.api.Health

/**
 * Where the app is told which server to talk to. Deliberately the first thing
 * a fresh install shows in server mode, and reachable again from settings, so
 * moving the backend to a VPS later is typing a new address here.
 */
@Composable
fun ConnectScreen(
    initialEndpoint: String,
    busy: Boolean,
    error: String?,
    health: Health?,
    canUseDirect: Boolean,
    onTest: (String) -> Unit,
    onContinue: (String) -> Unit,
    onUseDirect: () -> Unit
) {
    var endpoint by remember { mutableStateOf(initialEndpoint) }

    Column(
        Modifier
            .fillMaxSize()
            .background(T.Ink)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 48.dp, vertical = 44.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Box(Modifier.widthIn(max = 720.dp)) {
            Column {
                Eyebrow("Step one")
                Spacer(Modifier.height(14.dp))
                Title("Connect to your server")
                Spacer(Modifier.height(12.dp))
                Body(
                    "Telly keeps your channels, favourites and account on a server you run. " +
                        "Enter its address — a PC on this network to begin with, and somewhere " +
                        "else later without changing anything but this box."
                )

                Spacer(Modifier.height(36.dp))
                TvField(
                    label = "API server",
                    value = endpoint,
                    onValueChange = { endpoint = it },
                    hint = "192.168.1.10:8443",
                    keyboardType = KeyboardType.Uri,
                    imeAction = ImeAction.Done
                )
                Spacer(Modifier.height(10.dp))
                Body("Plain http is assumed unless you type https://.", T.Faint, 13)

                if (error != null) {
                    Spacer(Modifier.height(22.dp))
                    Notice(error)
                }
                if (health != null && error == null) {
                    Spacer(Modifier.height(22.dp))
                    Notice(
                        if (health.configured) "Found the server. Sign in on the next screen."
                        else "Found the server, but it has no accounts yet. Create one with telly-admin on the server first.",
                        if (health.configured) NoticeKind.Good else NoticeKind.Info
                    )
                }

                Spacer(Modifier.height(32.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    TvButton(
                        label = if (health != null && health.configured) "Continue" else "Test connection",
                        primary = true,
                        busy = busy,
                        enabled = endpoint.isNotBlank(),
                        onClick = { if (health != null && health.configured) onContinue(endpoint) else onTest(endpoint) }
                    )
                    if (health != null && health.configured) {
                        TvButton(label = "Test again", onClick = { onTest(endpoint) })
                    }
                }

                if (canUseDirect) {
                    Spacer(Modifier.height(40.dp))
                    Body("Or carry on without a server — add an M3U link, a file or Xtream details on this device.", T.Faint, 14)
                    Spacer(Modifier.height(14.dp))
                    TvButton(label = "Use a playlist on this device", onClick = onUseDirect)
                }
            }
        }
    }
}
