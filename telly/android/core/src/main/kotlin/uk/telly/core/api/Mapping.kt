package uk.telly.core.api

import uk.telly.core.Channel

/**
 * A server channel wearing the same shape as a playlist channel, so every
 * screen, the list, the search and the favourites work on one type and none of
 * them need to know where the channels came from.
 */
fun ServerChannel.toChannel(): Channel = Channel(
    id = "srv:$id",
    number = number,
    name = name,
    url = "",            // filled in a ticket at a time, never stored
    logo = logo,
    group = group.ifEmpty { "Ungrouped" },
    tvgId = tvgId,
    serverId = id
)

fun List<ServerChannel>.toChannels(): List<Channel> = map { it.toChannel() }
