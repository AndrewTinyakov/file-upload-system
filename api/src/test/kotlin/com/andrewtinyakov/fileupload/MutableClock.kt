package com.andrewtinyakov.fileupload

import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.concurrent.atomic.AtomicReference

class MutableClock : Clock() {
    private val current = AtomicReference(Instant.now())

    override fun getZone(): ZoneId = ZoneOffset.UTC

    override fun withZone(zone: ZoneId): Clock =
        fixed(
            instant(),
            zone,
        )

    override fun instant(): Instant = current.get()

    fun advance(duration: Duration) {
        current.updateAndGet { it.plus(duration) }
    }

    fun reset() {
        current.set(Instant.now())
    }
}
