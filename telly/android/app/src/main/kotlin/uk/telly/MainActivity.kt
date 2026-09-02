package uk.telly

import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uk.telly.core.Channel
import uk.telly.core.M3u
import uk.telly.core.Streams

private val Ink = Color(0xFF06070A)
private val Panel = Color(0xFF12151C)
private val Line = Color(0xFF262C36)
private val Txt = Color(0xFFF3F5F9)
private val Dim = Color(0xFF9AA5B4)
private val Gold = Color(0xFFE7C17A)
private val Bad = Color(0xFFFF6B78)

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme(colorScheme = darkColorScheme(background = Ink, surface = Panel)) { Telly() } }
    }
}

private enum class Screen { SOURCES, CHANNELS }

@Composable
private fun Telly() {
    val ctx = LocalContext.current
    val store = remember { Storage(ctx) }
    val scope = rememberCoroutineScope()

    var screen by remember { mutableStateOf(Screen.SOURCES) }
    var channels by remember { mutableStateOf(listOf<Channel>()) }
    var favourites by remember { mutableStateOf(store.favourites) }
    var busy by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var current by remember { mutableStateOf<Channel?>(null) }

    fun adopt(list: List<Channel>, source: Source, cache: String?) {
        channels = list
        store.source = source
        if (cache != null) store.cachePlaylist(cache)
        screen = Screen.CHANNELS
        message = null
        busy = null
    }

    /** Anything that touches the network, off the main thread, with the failure kept. */
    fun load(what: String, work: suspend () -> Unit) {
        busy = what
        message = null
        scope.launch {
            try { withContext(Dispatchers.IO) { work() } }
            catch (e: Exception) { message = e.message ?: "That did not work." }
            finally { busy = null }
        }
    }

    // Reload whatever was in use last time.
    LaunchedEffect(Unit) {
        val src = store.source
        if (src != null) {
            load("Reloading your playlist…") {
                val p = when (src) {
                    is Source.Url -> Loader.fromUrl(src.url)
                    is Source.Xc -> Loader.fromXtream(src.host, src.user, src.pass) {}
                    is Source.File -> {
                        val text = store.cachedPlaylist()
                            ?: throw Loader.Failed("That file is no longer stored — please pick it again.")
                        Loader.fromText(text)
                    }
                }
                withContext(Dispatchers.Main) {
                    channels = p.channels
                    current = p.channels.firstOrNull { it.id == store.lastChannelId }
                    screen = Screen.CHANNELS
                }
            }
        }
    }

    Surface(color = Ink, modifier = Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            TopBar(
                onSources = { screen = Screen.SOURCES },
                showSources = screen == Screen.CHANNELS
            )
            Box(Modifier.weight(1f)) {
                when (screen) {
                    Screen.SOURCES -> SourcesScreen(
                        busy = busy,
                        message = message,
                        hasPlaylist = channels.isNotEmpty(),
                        onBack = { if (channels.isNotEmpty()) screen = Screen.CHANNELS },
                        onUrl = { url ->
                            load("Fetching playlist…") {
                                val p = Loader.fromUrl(url)
                                withContext(Dispatchers.Main) { adopt(p.channels, Source.Url(url), null) }
                            }
                        },
                        onFile = { name, text ->
                            load("Reading file…") {
                                val p = Loader.fromText(text)
                                withContext(Dispatchers.Main) { adopt(p.channels, Source.File(name), text) }
                            }
                        },
                        onXtream = { host, user, pass ->
                            load("Signing in…") {
                                val p = Loader.fromXtream(host, user, pass) {}
                                withContext(Dispatchers.Main) { adopt(p.channels, Source.Xc(host, user, pass), null) }
                            }
                        },
                        onForget = {
                            store.forget()
                            channels = emptyList(); favourites = emptySet(); current = null
                            message = "Forgotten."
                        }
                    )

                    Screen.CHANNELS -> ChannelsScreen(
                        channels = channels,
                        favourites = favourites,
                        current = current,
                        busy = busy,
                        onToggleFavourite = { ch ->
                            favourites = if (favourites.contains(ch.id)) favourites - ch.id else favourites + ch.id
                            store.favourites = favourites
                        },
                        onPlay = { ch ->
                            current = ch
                            store.lastChannelId = ch.id
                        }
                    )
                }
            }
        }

        current?.let { ch ->
            PlayerScreen(
                channel = ch,
                onClose = { current = null }
            )
        }
    }
}

@Composable
private fun TopBar(onSources: () -> Unit, showSources: Boolean) {
    Row(
        Modifier.fillMaxWidth().background(Panel).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            Modifier.size(30.dp).clip(RoundedCornerShape(9.dp)).background(Gold),
            contentAlignment = Alignment.Center
        ) { Text("T", color = Ink, fontWeight = FontWeight.Black) }
        Spacer(Modifier.width(10.dp))
        Text(
            buildAnnotatedString {
                append("TEL")
                withStyle(SpanStyle(color = Gold)) { append("LY") }
            },
            color = Txt, fontWeight = FontWeight.Bold, letterSpacing = 3.sp
        )
        Spacer(Modifier.weight(1f))
        if (showSources) {
            TextButton(onClick = onSources) { Text("Playlist", color = Gold) }
        }
    }
}

/* ----------------------------- sources ----------------------------- */

@Composable
private fun SourcesScreen(
    busy: String?,
    message: String?,
    hasPlaylist: Boolean,
    onBack: () -> Unit,
    onUrl: (String) -> Unit,
    onFile: (String, String) -> Unit,
    onXtream: (String, String, String) -> Unit,
    onForget: () -> Unit
) {
    val ctx = LocalContext.current
    var tab by remember { mutableStateOf(0) }
    var url by remember { mutableStateOf("") }
    var host by remember { mutableStateOf("") }
    var user by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) {
            val name = uri.lastPathSegment?.substringAfterLast('/') ?: "playlist.m3u"
            val text = ctx.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
            if (text != null) onFile(name, text)
        }
    }

    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Text("Add playlist", color = Txt, fontSize = 30.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))
        Text(
            "This is the native player, so http streams and raw MPEG-TS both work — " +
                "the two things a browser refuses.",
            color = Dim, fontSize = 14.sp
        )
        Spacer(Modifier.height(18.dp))

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("M3U URL", "File", "Xtream").forEachIndexed { i, label ->
                val on = tab == i
                Box(
                    Modifier
                        .clip(RoundedCornerShape(12.dp))
                        .background(if (on) Gold.copy(alpha = 0.16f) else Panel)
                        .border(1.dp, if (on) Gold else Line, RoundedCornerShape(12.dp))
                        .clickable { tab = i }
                        .padding(horizontal = 18.dp, vertical = 12.dp)
                ) { Text(label, color = if (on) Gold else Dim) }
            }
        }

        Spacer(Modifier.height(18.dp))

        when (tab) {
            0 -> {
                Field("Playlist URL", url, { url = it }, "https://example.com/playlist.m3u")
                Spacer(Modifier.height(14.dp))
                GoldButton("Load playlist", enabled = busy == null) { onUrl(url.trim()) }
            }
            1 -> {
                Text("A playlist saved on this device.", color = Dim, fontSize = 14.sp)
                Spacer(Modifier.height(14.dp))
                GoldButton("Choose a file", enabled = busy == null) {
                    picker.launch(arrayOf("*/*"))
                }
            }
            else -> {
                Field("Server URL", host, { host = it }, "http://example.com:8080")
                Spacer(Modifier.height(10.dp))
                Field("Username", user, { user = it }, "")
                Spacer(Modifier.height(10.dp))
                Field("Password", pass, { pass = it }, "", password = true)
                Spacer(Modifier.height(14.dp))
                GoldButton("Sign in", enabled = busy == null) { onXtream(host.trim(), user.trim(), pass) }
            }
        }

        if (busy != null) {
            Spacer(Modifier.height(18.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(color = Gold, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(10.dp))
                Text(busy, color = Dim)
            }
        }
        if (message != null) {
            Spacer(Modifier.height(18.dp))
            Box(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
                    .background(Bad.copy(alpha = 0.12f)).padding(14.dp)
            ) { Text(message, color = Bad) }
        }

        Spacer(Modifier.weight(1f))
        Row {
            if (hasPlaylist) TextButton(onClick = onBack) { Text("Back to channels", color = Gold) }
            Spacer(Modifier.weight(1f))
            TextButton(onClick = onForget) { Text("Forget everything", color = Bad) }
        }
    }
}

@Composable
private fun Field(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    hint: String,
    password: Boolean = false
) {
    Column {
        Text(label.uppercase(), color = Dim, fontSize = 11.sp, letterSpacing = 2.sp)
        Spacer(Modifier.height(6.dp))
        Box(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Panel)
                .border(1.dp, Line, RoundedCornerShape(12.dp))
                .padding(horizontal = 14.dp, vertical = 14.dp)
        ) {
            if (value.isEmpty() && hint.isNotEmpty()) Text(hint, color = Dim.copy(alpha = 0.6f))
            BasicTextField(
                value = value,
                onValueChange = onChange,
                singleLine = true,
                textStyle = androidx.compose.ui.text.TextStyle(color = Txt, fontSize = 16.sp),
                cursorBrush = androidx.compose.ui.graphics.SolidColor(Gold),
                visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}

@Composable
private fun GoldButton(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(14.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = Ink)
    ) { Text(label, fontWeight = FontWeight.Bold) }
}

/* ----------------------------- channels ----------------------------- */

@Composable
private fun ChannelsScreen(
    channels: List<Channel>,
    favourites: Set<String>,
    current: Channel?,
    busy: String?,
    onToggleFavourite: (Channel) -> Unit,
    onPlay: (Channel) -> Unit
) {
    var query by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("All channels") }

    val groups = remember(channels) { M3u.groups(channels) }
    val shown = remember(channels, query, category, favourites) {
        channels.asSequence()
            .filter { query.isBlank() || it.key.contains(query.trim().lowercase()) }
            .filter {
                when (category) {
                    "All channels" -> true
                    "Favourites" -> favourites.contains(it.id)
                    else -> it.group == category
                }
            }
            .toList()
    }

    Column(Modifier.fillMaxSize()) {
        Box(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
            Field("Search", query, { query = it }, "Search channels")
        }

        LazyRow(
            Modifier.fillMaxWidth().padding(horizontal = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(listOf("All channels", "Favourites") + groups) { name ->
                val on = category == name
                Box(
                    Modifier.clip(RoundedCornerShape(999.dp))
                        .background(if (on) Gold.copy(alpha = 0.16f) else Panel)
                        .border(1.dp, if (on) Gold else Line, RoundedCornerShape(999.dp))
                        .clickable { category = name }
                        .padding(horizontal = 16.dp, vertical = 10.dp)
                ) { Text(name, color = if (on) Gold else Dim, maxLines = 1) }
            }
        }

        Spacer(Modifier.height(8.dp))
        Text(
            if (busy != null) busy else "${shown.size} of ${channels.size} channels",
            color = Dim, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 18.dp)
        )
        Spacer(Modifier.height(6.dp))

        LazyColumn(state = rememberLazyListState(), modifier = Modifier.fillMaxSize()) {
            items(shown, key = { it.id }) { ch ->
                ChannelRow(
                    ch = ch,
                    favourite = favourites.contains(ch.id),
                    playing = current?.id == ch.id,
                    onPlay = { onPlay(ch) },
                    onToggleFavourite = { onToggleFavourite(ch) }
                )
            }
        }
    }
}

@Composable
private fun ChannelRow(
    ch: Channel,
    favourite: Boolean,
    playing: Boolean,
    onPlay: () -> Unit,
    onToggleFavourite: () -> Unit
) {
    Row(
        Modifier.fillMaxWidth()
            .padding(horizontal = 10.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(if (playing) Gold.copy(alpha = 0.12f) else Color.Transparent)
            .clickable { onPlay() }
            .padding(horizontal = 10.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            ch.number.toString().padStart(2, '0'),
            color = Dim, fontSize = 12.sp, modifier = Modifier.width(34.dp)
        )
        Box(
            Modifier.size(48.dp).clip(RoundedCornerShape(12.dp)).background(Panel),
            contentAlignment = Alignment.Center
        ) {
            if (ch.logo.isNotEmpty()) {
                AsyncImage(
                    model = ch.logo,
                    contentDescription = null,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxSize().padding(6.dp)
                )
            } else {
                Text(initials(ch.name), color = Dim, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                ch.name,
                color = if (playing) Gold else Txt,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
                fontWeight = if (playing) FontWeight.Bold else FontWeight.Normal
            )
            Text(ch.group, color = Dim, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        TextButton(onClick = onToggleFavourite) {
            Text(if (favourite) "★" else "☆", color = if (favourite) Gold else Dim, fontSize = 20.sp)
        }
    }
}

private fun initials(name: String): String {
    val words = name.split(Regex("\\s+")).filter { it.isNotBlank() }
    return words.take(2).joinToString("") { it.first().uppercase() }.ifEmpty { "?" }
}

/* ----------------------------- player ----------------------------- */

@Composable
private fun PlayerScreen(channel: Channel, onClose: () -> Unit) {
    val ctx = LocalContext.current
    var error by remember(channel.id) { mutableStateOf<String?>(Streams.refusal(channel.url)) }
    var buffering by remember(channel.id) { mutableStateOf(true) }

    val player = remember(channel.id) {
        if (Streams.refusal(channel.url) != null) null
        else ExoPlayer.Builder(ctx).build().apply {
            val item = MediaItem.Builder().setUri(channel.url).apply {
                if (Streams.isHls(channel.url)) setMimeType(MimeTypes.APPLICATION_M3U8)
            }.build()
            setMediaItem(item)
            addListener(object : Player.Listener {
                override fun onPlayerError(e: PlaybackException) {
                    error = "${e.errorCodeName}: ${e.message ?: "the stream would not open"}"
                    buffering = false
                }
                override fun onPlaybackStateChanged(state: Int) {
                    buffering = state == Player.STATE_BUFFERING
                }
            })
            prepare()
            playWhenReady = true
        }
    }

    DisposableEffect(channel.id) {
        onDispose { player?.release() }
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (player != null) {
            AndroidView(
                factory = { c -> PlayerView(c).apply { this.player = player; useController = true } },
                modifier = Modifier.fillMaxSize()
            )
        }

        if (error != null) {
            Column(
                Modifier.fillMaxSize().background(Color(0xCC06070A)).padding(28.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text("This channel would not play", color = Txt, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(10.dp))
                Text(error!!, color = Dim, fontSize = 14.sp)
                Spacer(Modifier.height(20.dp))
                GoldButton("Back") { onClose() }
            }
        } else if (buffering) {
            Column(
                Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                CircularProgressIndicator(color = Gold, strokeWidth = 3.dp)
                Spacer(Modifier.height(14.dp))
                Text(channel.name, color = Txt)
            }
        }

        TextButton(
            onClick = onClose,
            modifier = Modifier.align(Alignment.TopStart).padding(10.dp)
        ) { Text("‹ Channels", color = Gold) }
    }
}
