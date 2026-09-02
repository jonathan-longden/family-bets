package uk.telly.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp

/**
 * Signing in. Two fields, one action, and enough room that it reads from a
 * sofa — the same ink, gold and glass as the rest of Telly rather than a web
 * form in a television's clothing.
 */
@Composable
fun LoginScreen(
    serverLabel: String,
    initialUsername: String,
    busy: Boolean,
    error: String?,
    onSignIn: (String, String) -> Unit,
    onChangeServer: () -> Unit
) {
    var username by remember { mutableStateOf(initialUsername) }
    var password by remember { mutableStateOf("") }
    val first = remember { FocusRequester() }

    LaunchedEffect(Unit) { runCatching { first.requestFocus() } }

    Column(
        Modifier
            .fillMaxSize()
            .background(T.Ink)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 48.dp, vertical = 44.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Box(Modifier.widthIn(max = 640.dp)) {
            Column {
                Eyebrow("Telly")
                Spacer(Modifier.height(14.dp))
                Title("Sign in")
                Spacer(Modifier.height(10.dp))
                Body(serverLabel, T.Faint, 14)

                Spacer(Modifier.height(36.dp))
                TvField(
                    label = "Username",
                    value = username,
                    onValueChange = { username = it },
                    hint = "your account name",
                    modifier = Modifier.focusRequester(first)
                )
                Spacer(Modifier.height(22.dp))
                TvField(
                    label = "Password",
                    value = password,
                    onValueChange = { password = it },
                    password = true,
                    imeAction = ImeAction.Done
                )

                if (error != null) {
                    Spacer(Modifier.height(24.dp))
                    Notice(error)
                }

                Spacer(Modifier.height(32.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    TvButton(
                        label = "Sign in",
                        primary = true,
                        busy = busy,
                        enabled = username.isNotBlank() && password.isNotBlank(),
                        onClick = { onSignIn(username.trim(), password) }
                    )
                    TvButton(label = "Change server", onClick = onChangeServer)
                }
            }
        }
    }
}
