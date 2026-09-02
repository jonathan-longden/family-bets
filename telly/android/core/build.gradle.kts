// Pure Kotlin/JVM: the playlist and Xtream logic, with no Android in it, so it
// can be unit-tested on any machine. The app module compiles these same sources.
plugins {
    kotlin("jvm") version "2.0.21"
}

repositories { mavenCentral() }

dependencies {
    testImplementation(kotlin("test"))
}

// No toolchain pin: this module is plain Kotlin and compiles on whatever
// JDK is to hand (21 locally, 17 on CI).

tasks.test { useJUnitPlatform() }
