package com.andrewtinyakov.fileupload.shared.integration

class DependencyUnavailableException(
    val dependency: String,
    cause: Throwable,
) : RuntimeException(
        "Dependency unavailable: $dependency",
        cause,
    )
