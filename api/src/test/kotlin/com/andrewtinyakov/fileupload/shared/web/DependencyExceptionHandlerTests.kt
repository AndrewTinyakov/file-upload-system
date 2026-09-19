package com.andrewtinyakov.fileupload.shared.web

import com.andrewtinyakov.fileupload.shared.integration.DependencyUnavailableException
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

class DependencyExceptionHandlerTests {
    private val handler = ApiExceptionHandler()

    @Test
    fun `dependency error hides its cause`() {
        val problem =
            handler.handle(
                DependencyUnavailableException(
                    "object storage",
                    IllegalStateException("connection failed"),
                ),
            )

        assertEquals(503, problem.status)
        assertEquals("A required service is temporarily unavailable", problem.detail)
        assertEquals("SERVICE_UNAVAILABLE", problem.properties?.get("code"))
        assertFalse(problem.detail.orEmpty().contains("object storage"))
        assertFalse(problem.detail.orEmpty().contains("connection failed"))
    }
}
