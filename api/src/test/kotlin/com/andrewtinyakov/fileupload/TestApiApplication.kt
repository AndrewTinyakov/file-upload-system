package com.andrewtinyakov.fileupload

import org.springframework.boot.fromApplication
import org.springframework.boot.with

fun main(args: Array<String>) {
    fromApplication<ApiApplication>().with(TestcontainersConfig::class).run(*args)
}
