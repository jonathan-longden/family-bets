// Pure Kotlin/JVM: the playlist and Xtream logic, with no Android in it, so it
// can be unit-tested on any machine. The app module compiles these same sources.
plugins {
    kotlin("jvm") version "2.0.21"
}

repositories { mavenCentral() }

dependencies {
    // okhttp and org.json are both present on Android already, so they are
    // compileOnly here and supplied by the platform there. The tests bring
    // their own copies, including MockWebServer, so the API client is
    // exercised against a real server rather than a stub.
    compileOnly("com.squareup.okhttp3:okhttp:4.12.0")
    compileOnly("org.json:json:20240303")

    testImplementation(kotlin("test"))
    testImplementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.json:json:20240303")
}

// No toolchain pin: this module is plain Kotlin and compiles on whatever
// JDK is to hand (21 locally, 17 on CI).

tasks.test { useJUnitPlatform() }
