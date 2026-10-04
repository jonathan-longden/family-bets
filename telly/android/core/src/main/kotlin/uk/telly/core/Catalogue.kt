package uk.telly.core

/**
 * Public playlist collections, so the app ships with something to watch
 * without anyone having to find a URL first.
 *
 * Telly hosts none of these. Picking one fetches it exactly as typing the URL
 * into the M3U field would. The sources are:
 *
 *  - iptv-org          https://github.com/iptv-org/iptv
 *  - Free-TV/IPTV      https://github.com/Free-TV/IPTV
 *  - matthuisman       https://i.mjh.nz
 *
 * This is the same table the web player carries, generated from it so the two
 * cannot drift. The native player is the more capable of the pair here: a good
 * number of these streams are plain http:// or raw MPEG-TS, which a browser
 * refuses outright and ExoPlayer plays without complaint.
 */
data class CatalogueEntry(
    val group: String,
    val name: String,
    val detail: String,
    val url: String
)

object Catalogue {

    private fun E(group: String, name: String, detail: String, url: String) =
        CatalogueEntry(group, name, detail, url)

    val entries: List<CatalogueEntry> = listOf(
        E("Everything", "All channels", "Every stream iptv-org indexes, worldwide", "https://iptv-org.github.io/iptv/index.m3u"),
        E("Everything", "Grouped by country", "The same list, with country group titles", "https://iptv-org.github.io/iptv/index.country.m3u"),
        E("Everything", "Grouped by category", "The same list, with genre group titles", "https://iptv-org.github.io/iptv/index.category.m3u"),
        E("Everything", "Grouped by language", "The same list, with language group titles", "https://iptv-org.github.io/iptv/index.language.m3u"),
        E("Everything", "Free-TV curated list", "A smaller hand-checked selection — split up further below (Free-TV/IPTV)", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8"),
        E("By country", "United Kingdom", "https://iptv-org.github.io/iptv/countries/uk.m3u", "https://iptv-org.github.io/iptv/countries/uk.m3u"),
        E("By country", "Ireland", "https://iptv-org.github.io/iptv/countries/ie.m3u", "https://iptv-org.github.io/iptv/countries/ie.m3u"),
        E("By country", "United States", "https://iptv-org.github.io/iptv/countries/us.m3u", "https://iptv-org.github.io/iptv/countries/us.m3u"),
        E("By country", "Canada", "https://iptv-org.github.io/iptv/countries/ca.m3u", "https://iptv-org.github.io/iptv/countries/ca.m3u"),
        E("By country", "France", "https://iptv-org.github.io/iptv/countries/fr.m3u", "https://iptv-org.github.io/iptv/countries/fr.m3u"),
        E("By country", "Germany", "https://iptv-org.github.io/iptv/countries/de.m3u", "https://iptv-org.github.io/iptv/countries/de.m3u"),
        E("By country", "Spain", "https://iptv-org.github.io/iptv/countries/es.m3u", "https://iptv-org.github.io/iptv/countries/es.m3u"),
        E("By country", "Italy", "https://iptv-org.github.io/iptv/countries/it.m3u", "https://iptv-org.github.io/iptv/countries/it.m3u"),
        E("By country", "Portugal", "https://iptv-org.github.io/iptv/countries/pt.m3u", "https://iptv-org.github.io/iptv/countries/pt.m3u"),
        E("By country", "Netherlands", "https://iptv-org.github.io/iptv/countries/nl.m3u", "https://iptv-org.github.io/iptv/countries/nl.m3u"),
        E("By country", "Belgium", "https://iptv-org.github.io/iptv/countries/be.m3u", "https://iptv-org.github.io/iptv/countries/be.m3u"),
        E("By country", "Switzerland", "https://iptv-org.github.io/iptv/countries/ch.m3u", "https://iptv-org.github.io/iptv/countries/ch.m3u"),
        E("By country", "Austria", "https://iptv-org.github.io/iptv/countries/at.m3u", "https://iptv-org.github.io/iptv/countries/at.m3u"),
        E("By country", "Poland", "https://iptv-org.github.io/iptv/countries/pl.m3u", "https://iptv-org.github.io/iptv/countries/pl.m3u"),
        E("By country", "Greece", "https://iptv-org.github.io/iptv/countries/gr.m3u", "https://iptv-org.github.io/iptv/countries/gr.m3u"),
        E("By country", "Sweden", "https://iptv-org.github.io/iptv/countries/se.m3u", "https://iptv-org.github.io/iptv/countries/se.m3u"),
        E("By country", "Norway", "https://iptv-org.github.io/iptv/countries/no.m3u", "https://iptv-org.github.io/iptv/countries/no.m3u"),
        E("By country", "Denmark", "https://iptv-org.github.io/iptv/countries/dk.m3u", "https://iptv-org.github.io/iptv/countries/dk.m3u"),
        E("By country", "Finland", "https://iptv-org.github.io/iptv/countries/fi.m3u", "https://iptv-org.github.io/iptv/countries/fi.m3u"),
        E("By country", "Czechia", "https://iptv-org.github.io/iptv/countries/cz.m3u", "https://iptv-org.github.io/iptv/countries/cz.m3u"),
        E("By country", "Romania", "https://iptv-org.github.io/iptv/countries/ro.m3u", "https://iptv-org.github.io/iptv/countries/ro.m3u"),
        E("By country", "Turkey", "https://iptv-org.github.io/iptv/countries/tr.m3u", "https://iptv-org.github.io/iptv/countries/tr.m3u"),
        E("By country", "Ukraine", "https://iptv-org.github.io/iptv/countries/ua.m3u", "https://iptv-org.github.io/iptv/countries/ua.m3u"),
        E("By country", "Russia", "https://iptv-org.github.io/iptv/countries/ru.m3u", "https://iptv-org.github.io/iptv/countries/ru.m3u"),
        E("By country", "India", "https://iptv-org.github.io/iptv/countries/in.m3u", "https://iptv-org.github.io/iptv/countries/in.m3u"),
        E("By country", "Pakistan", "https://iptv-org.github.io/iptv/countries/pk.m3u", "https://iptv-org.github.io/iptv/countries/pk.m3u"),
        E("By country", "Japan", "https://iptv-org.github.io/iptv/countries/jp.m3u", "https://iptv-org.github.io/iptv/countries/jp.m3u"),
        E("By country", "South Korea", "https://iptv-org.github.io/iptv/countries/kr.m3u", "https://iptv-org.github.io/iptv/countries/kr.m3u"),
        E("By country", "China", "https://iptv-org.github.io/iptv/countries/cn.m3u", "https://iptv-org.github.io/iptv/countries/cn.m3u"),
        E("By country", "Australia", "https://iptv-org.github.io/iptv/countries/au.m3u", "https://iptv-org.github.io/iptv/countries/au.m3u"),
        E("By country", "New Zealand", "https://iptv-org.github.io/iptv/countries/nz.m3u", "https://iptv-org.github.io/iptv/countries/nz.m3u"),
        E("By country", "Brazil", "https://iptv-org.github.io/iptv/countries/br.m3u", "https://iptv-org.github.io/iptv/countries/br.m3u"),
        E("By country", "Mexico", "https://iptv-org.github.io/iptv/countries/mx.m3u", "https://iptv-org.github.io/iptv/countries/mx.m3u"),
        E("By country", "Argentina", "https://iptv-org.github.io/iptv/countries/ar.m3u", "https://iptv-org.github.io/iptv/countries/ar.m3u"),
        E("By country", "South Africa", "https://iptv-org.github.io/iptv/countries/za.m3u", "https://iptv-org.github.io/iptv/countries/za.m3u"),
        E("By country", "Nigeria", "https://iptv-org.github.io/iptv/countries/ng.m3u", "https://iptv-org.github.io/iptv/countries/ng.m3u"),
        E("By country", "Egypt", "https://iptv-org.github.io/iptv/countries/eg.m3u", "https://iptv-org.github.io/iptv/countries/eg.m3u"),
        E("By country", "United Arab Emirates", "https://iptv-org.github.io/iptv/countries/ae.m3u", "https://iptv-org.github.io/iptv/countries/ae.m3u"),
        E("By category", "News", "Rolling news channels worldwide", "https://iptv-org.github.io/iptv/categories/news.m3u"),
        E("By category", "Sport", "Free-to-air sport — not subscription channels", "https://iptv-org.github.io/iptv/categories/sports.m3u"),
        E("By category", "Movies", "Film channels", "https://iptv-org.github.io/iptv/categories/movies.m3u"),
        E("By category", "Series", "Drama and box-set channels", "https://iptv-org.github.io/iptv/categories/series.m3u"),
        E("By category", "Music", "Music video and radio-on-TV channels", "https://iptv-org.github.io/iptv/categories/music.m3u"),
        E("By category", "Kids", "Childrens channels", "https://iptv-org.github.io/iptv/categories/kids.m3u"),
        E("By category", "Documentary", "Factual and nature channels", "https://iptv-org.github.io/iptv/categories/documentary.m3u"),
        E("By category", "Science", "Science and technology", "https://iptv-org.github.io/iptv/categories/science.m3u"),
        E("By category", "Comedy", "Comedy channels", "https://iptv-org.github.io/iptv/categories/comedy.m3u"),
        E("By category", "Travel", "Travel and lifestyle", "https://iptv-org.github.io/iptv/categories/travel.m3u"),
        E("By category", "Cooking", "Food and cooking", "https://iptv-org.github.io/iptv/categories/cooking.m3u"),
        E("By category", "Weather", "Weather channels", "https://iptv-org.github.io/iptv/categories/weather.m3u"),
        E("By category", "Classic", "Archive and classic television", "https://iptv-org.github.io/iptv/categories/classic.m3u"),
        E("By category", "Animation", "Animation channels", "https://iptv-org.github.io/iptv/categories/animation.m3u"),
        E("By category", "Religious", "Religious broadcasters", "https://iptv-org.github.io/iptv/categories/religious.m3u"),
        E("By category", "Business", "Business and markets", "https://iptv-org.github.io/iptv/categories/business.m3u"),
        E("Free ad-supported services", "Pluto TV", "All Pluto TV channels (i.mjh.nz)", "https://i.mjh.nz/PlutoTV/all.m3u8"),
        E("Free ad-supported services", "Samsung TV Plus", "All Samsung TV Plus channels (i.mjh.nz)", "https://i.mjh.nz/SamsungTVPlus/all.m3u8"),
        E("Free ad-supported services", "Plex TV", "Plex free live channels (i.mjh.nz)", "https://i.mjh.nz/Plex/all.m3u8"),
        E("Free ad-supported services", "Roku Channel", "The Roku Channel live line-up (i.mjh.nz)", "https://i.mjh.nz/Roku/all.m3u8"),
        E("Free ad-supported services", "Stirr", "Stirr live channels (i.mjh.nz)", "https://i.mjh.nz/Stirr/all.m3u8"),
        E("Free-TV — by topic", "Film channels", "Round-the-clock film channels — FilmRise, Pluto, Xumo", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_zz_movies.m3u8"),
        E("Free-TV — by topic", "Film and box sets (Italian)", "Italian on-demand film and series channels", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_zz_vod_it.m3u8"),
        E("Free-TV — by topic", "News, business and weather", "English-language rolling news, markets and weather", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_zz_news_en.m3u8"),
        E("Free-TV — by topic", "News (Arabic)", "Arabic-language rolling news", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_zz_news_ar.m3u8"),
        E("Free-TV — by topic", "News (Spanish)", "Spanish-language rolling news", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_zz_news_es.m3u8"),
        E("Free-TV — by topic", "Documentaries", "English-language factual channels", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_zz_documentaries_en.m3u8"),
        E("Free-TV — by topic", "Documentaries (Arabic)", "Arabic-language factual channels", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_zz_documentaries_ar.m3u8"),
        E("Free-TV — by topic", "Music", "English-language music channels", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_zz_music_en.m3u8"),
        E("Free-TV — by country", "Albania", "Hand-checked free-to-air channels for Albania", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_albania.m3u8"),
        E("Free-TV — by country", "Andorra", "Hand-checked free-to-air channels for Andorra", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_andorra.m3u8"),
        E("Free-TV — by country", "Argentina", "Hand-checked free-to-air channels for Argentina", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_argentina.m3u8"),
        E("Free-TV — by country", "Armenia", "Hand-checked free-to-air channels for Armenia", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_armenia.m3u8"),
        E("Free-TV — by country", "Australia", "Hand-checked free-to-air channels for Australia", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_australia.m3u8"),
        E("Free-TV — by country", "Austria", "Hand-checked free-to-air channels for Austria", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_austria.m3u8"),
        E("Free-TV — by country", "Azerbaijan", "Hand-checked free-to-air channels for Azerbaijan", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_azerbaijan.m3u8"),
        E("Free-TV — by country", "Belarus", "Hand-checked free-to-air channels for Belarus", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_belarus.m3u8"),
        E("Free-TV — by country", "Belgium", "Hand-checked free-to-air channels for Belgium", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_belgium.m3u8"),
        E("Free-TV — by country", "Bosnia and Herzegovina", "Hand-checked free-to-air channels for Bosnia and Herzegovina", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_bosnia_and_herzegovina.m3u8"),
        E("Free-TV — by country", "Brazil", "Hand-checked free-to-air channels for Brazil", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_brazil.m3u8"),
        E("Free-TV — by country", "Bulgaria", "Hand-checked free-to-air channels for Bulgaria", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_bulgaria.m3u8"),
        E("Free-TV — by country", "Canada", "Hand-checked free-to-air channels for Canada", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_canada.m3u8"),
        E("Free-TV — by country", "Chad", "Hand-checked free-to-air channels for Chad", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_chad.m3u8"),
        E("Free-TV — by country", "Chile", "Hand-checked free-to-air channels for Chile", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_chile.m3u8"),
        E("Free-TV — by country", "China", "Hand-checked free-to-air channels for China", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_china.m3u8"),
        E("Free-TV — by country", "Costa Rica", "Hand-checked free-to-air channels for Costa Rica", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_costa_rica.m3u8"),
        E("Free-TV — by country", "Croatia", "Hand-checked free-to-air channels for Croatia", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_croatia.m3u8"),
        E("Free-TV — by country", "Cyprus", "Hand-checked free-to-air channels for Cyprus", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_cyprus.m3u8"),
        E("Free-TV — by country", "Czech Republic", "Hand-checked free-to-air channels for Czech Republic", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_czech_republic.m3u8"),
        E("Free-TV — by country", "Denmark", "Hand-checked free-to-air channels for Denmark", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_denmark.m3u8"),
        E("Free-TV — by country", "Dominican Republic", "Hand-checked free-to-air channels for Dominican Republic", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_dominican_republic.m3u8"),
        E("Free-TV — by country", "Egypt", "Hand-checked free-to-air channels for Egypt", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_egypt.m3u8"),
        E("Free-TV — by country", "Estonia", "Hand-checked free-to-air channels for Estonia", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_estonia.m3u8"),
        E("Free-TV — by country", "Faroe Islands", "Hand-checked free-to-air channels for Faroe Islands", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_faroe_islands.m3u8"),
        E("Free-TV — by country", "Finland", "Hand-checked free-to-air channels for Finland", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_finland.m3u8"),
        E("Free-TV — by country", "France", "Hand-checked free-to-air channels for France", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_france.m3u8"),
        E("Free-TV — by country", "Georgia", "Hand-checked free-to-air channels for Georgia", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_georgia.m3u8"),
        E("Free-TV — by country", "Germany", "Hand-checked free-to-air channels for Germany", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_germany.m3u8"),
        E("Free-TV — by country", "Greece", "Hand-checked free-to-air channels for Greece", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_greece.m3u8"),
        E("Free-TV — by country", "Greenland", "Hand-checked free-to-air channels for Greenland", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_greenland.m3u8"),
        E("Free-TV — by country", "Hong Kong", "Hand-checked free-to-air channels for Hong Kong", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_hong_kong.m3u8"),
        E("Free-TV — by country", "Hungary", "Hand-checked free-to-air channels for Hungary", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_hungary.m3u8"),
        E("Free-TV — by country", "Iceland", "Hand-checked free-to-air channels for Iceland", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_iceland.m3u8"),
        E("Free-TV — by country", "India", "Hand-checked free-to-air channels for India", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_india.m3u8"),
        E("Free-TV — by country", "Indonesia", "Hand-checked free-to-air channels for Indonesia", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_indonesia.m3u8"),
        E("Free-TV — by country", "Iran", "Hand-checked free-to-air channels for Iran", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_iran.m3u8"),
        E("Free-TV — by country", "Iraq", "Hand-checked free-to-air channels for Iraq", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_iraq.m3u8"),
        E("Free-TV — by country", "Ireland", "Hand-checked free-to-air channels for Ireland", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_ireland.m3u8"),
        E("Free-TV — by country", "Israel", "Hand-checked free-to-air channels for Israel", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_israel.m3u8"),
        E("Free-TV — by country", "Italy", "Hand-checked free-to-air channels for Italy", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_italy.m3u8"),
        E("Free-TV — by country", "Japan", "Hand-checked free-to-air channels for Japan", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_japan.m3u8"),
        E("Free-TV — by country", "Kazakhstan", "Hand-checked free-to-air channels for Kazakhstan", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_kazakhstan.m3u8"),
        E("Free-TV — by country", "Kenya", "Hand-checked free-to-air channels for Kenya", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_kenya.m3u8"),
        E("Free-TV — by country", "Korea", "Hand-checked free-to-air channels for Korea", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_korea.m3u8"),
        E("Free-TV — by country", "Kosovo", "Hand-checked free-to-air channels for Kosovo", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_kosovo.m3u8"),
        E("Free-TV — by country", "Latvia", "Hand-checked free-to-air channels for Latvia", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_latvia.m3u8"),
        E("Free-TV — by country", "Lebanon", "Hand-checked free-to-air channels for Lebanon", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_lebanon.m3u8"),
        E("Free-TV — by country", "Lithuania", "Hand-checked free-to-air channels for Lithuania", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_lithuania.m3u8"),
        E("Free-TV — by country", "Luxembourg", "Hand-checked free-to-air channels for Luxembourg", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_luxembourg.m3u8"),
        E("Free-TV — by country", "Macau", "Hand-checked free-to-air channels for Macau", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_macau.m3u8"),
        E("Free-TV — by country", "Malta", "Hand-checked free-to-air channels for Malta", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_malta.m3u8"),
        E("Free-TV — by country", "Mexico", "Hand-checked free-to-air channels for Mexico", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_mexico.m3u8"),
        E("Free-TV — by country", "Moldova", "Hand-checked free-to-air channels for Moldova", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_moldova.m3u8"),
        E("Free-TV — by country", "Monaco", "Hand-checked free-to-air channels for Monaco", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_monaco.m3u8"),
        E("Free-TV — by country", "Mongolia", "Hand-checked free-to-air channels for Mongolia", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_mongolia.m3u8"),
        E("Free-TV — by country", "Montenegro", "Hand-checked free-to-air channels for Montenegro", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_montenegro.m3u8"),
        E("Free-TV — by country", "Netherlands", "Hand-checked free-to-air channels for Netherlands", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_netherlands.m3u8"),
        E("Free-TV — by country", "Nigeria", "Hand-checked free-to-air channels for Nigeria", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_nigeria.m3u8"),
        E("Free-TV — by country", "North Korea", "Hand-checked free-to-air channels for North Korea", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_north_korea.m3u8"),
        E("Free-TV — by country", "North Macedonia", "Hand-checked free-to-air channels for North Macedonia", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_north_macedonia.m3u8"),
        E("Free-TV — by country", "Norway", "Hand-checked free-to-air channels for Norway", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_norway.m3u8"),
        E("Free-TV — by country", "Paraguay", "Hand-checked free-to-air channels for Paraguay", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_paraguay.m3u8"),
        E("Free-TV — by country", "Peru", "Hand-checked free-to-air channels for Peru", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_peru.m3u8"),
        E("Free-TV — by country", "Poland", "Hand-checked free-to-air channels for Poland", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_poland.m3u8"),
        E("Free-TV — by country", "Portugal", "Hand-checked free-to-air channels for Portugal", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_portugal.m3u8"),
        E("Free-TV — by country", "Qatar", "Hand-checked free-to-air channels for Qatar", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_qatar.m3u8"),
        E("Free-TV — by country", "Romania", "Hand-checked free-to-air channels for Romania", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_romania.m3u8"),
        E("Free-TV — by country", "Russia", "Hand-checked free-to-air channels for Russia", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_russia.m3u8"),
        E("Free-TV — by country", "San Marino", "Hand-checked free-to-air channels for San Marino", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_san_marino.m3u8"),
        E("Free-TV — by country", "Saudi Arabia", "Hand-checked free-to-air channels for Saudi Arabia", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_saudi_arabia.m3u8"),
        E("Free-TV — by country", "Serbia", "Hand-checked free-to-air channels for Serbia", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_serbia.m3u8"),
        E("Free-TV — by country", "Slovakia", "Hand-checked free-to-air channels for Slovakia", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_slovakia.m3u8"),
        E("Free-TV — by country", "Slovenia", "Hand-checked free-to-air channels for Slovenia", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_slovenia.m3u8"),
        E("Free-TV — by country", "Somalia", "Hand-checked free-to-air channels for Somalia", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_somalia.m3u8"),
        E("Free-TV — by country", "Spain", "Hand-checked free-to-air channels for Spain", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_spain.m3u8"),
        E("Free-TV — by country", "Sweden", "Hand-checked free-to-air channels for Sweden", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_sweden.m3u8"),
        E("Free-TV — by country", "Switzerland", "Hand-checked free-to-air channels for Switzerland", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_switzerland.m3u8"),
        E("Free-TV — by country", "Taiwan", "Hand-checked free-to-air channels for Taiwan", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_taiwan.m3u8"),
        E("Free-TV — by country", "Trinidad", "Hand-checked free-to-air channels for Trinidad", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_trinidad.m3u8"),
        E("Free-TV — by country", "Turkey", "Hand-checked free-to-air channels for Turkey", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_turkey.m3u8"),
        E("Free-TV — by country", "Turkmenistan", "Hand-checked free-to-air channels for Turkmenistan", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_turkmenistan.m3u8"),
        E("Free-TV — by country", "Ukraine", "Hand-checked free-to-air channels for Ukraine", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_ukraine.m3u8"),
        E("Free-TV — by country", "United Arab Emirates", "Hand-checked free-to-air channels for United Arab Emirates", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_united_arab_emirates.m3u8"),
        E("Free-TV — by country", "United Kingdom", "Hand-checked free-to-air channels for United Kingdom", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_uk.m3u8"),
        E("Free-TV — by country", "United States", "Hand-checked free-to-air channels for United States", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_usa.m3u8"),
        E("Free-TV — by country", "Venezuela", "Hand-checked free-to-air channels for Venezuela", "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_venezuela.m3u8"),
    )

    /** Group names in the order they first appear, for section headers. */
    fun groups(): List<String> = entries.map { it.group }.distinct()

    /** Entries of one group, in table order. */
    fun inGroup(group: String): List<CatalogueEntry> = entries.filter { it.group == group }

    /**
     * Case-insensitive search over name, group and description — the same
     * fields the web player's filter box looks at. A blank query returns
     * everything, so the caller can bind this straight to a text field.
     */
    fun search(query: String): List<CatalogueEntry> {
        val q = query.trim().lowercase()
        if (q.isEmpty()) return entries
        return entries.filter {
            it.name.lowercase().contains(q) ||
                it.group.lowercase().contains(q) ||
                it.detail.lowercase().contains(q)
        }
    }
}
