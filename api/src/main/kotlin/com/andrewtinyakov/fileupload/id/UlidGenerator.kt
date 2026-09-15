package com.andrewtinyakov.fileupload.id

import com.github.f4b6a3.ulid.UlidCreator
import org.springframework.stereotype.Component

@Component
class UlidGenerator {

    fun generate(): String = UlidCreator.getMonotonicUlid().toString()
}
