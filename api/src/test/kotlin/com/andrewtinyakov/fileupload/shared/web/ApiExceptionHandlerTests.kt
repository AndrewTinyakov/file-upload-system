package com.andrewtinyakov.fileupload.shared.web

import org.junit.jupiter.api.Test
import org.springframework.http.HttpStatus
import kotlin.test.assertEquals
import kotlin.test.assertFalse

class ApiExceptionHandlerTests {
    private val handler = ApiExceptionHandler()

    @Test
    fun `API error keeps its status code and message`() {
        val problem =
            handler.handle(
                ApiException(
                    HttpStatus.CONFLICT,
                    ApiErrorCode.SESSION_CLOSED,
                    "Session is closed",
                ),
            )

        assertEquals(409, problem.status)
        assertEquals("Session is closed", problem.detail)
        assertEquals("SESSION_CLOSED", problem.properties?.get("code"))
    }

    @Test
    fun `unexpected error hides its message`() {
        val problem = handler.handleUnexpected(IllegalStateException("database password"))

        assertEquals(500, problem.status)
        assertEquals("An unexpected error occurred", problem.detail)
        assertEquals("INTERNAL_SERVER_ERROR", problem.properties?.get("code"))
        assertFalse(problem.detail.orEmpty().contains("database password"))
    }
}
