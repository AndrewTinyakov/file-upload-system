package com.andrewtinyakov.fileupload.user

import com.andrewtinyakov.fileupload.shared.web.ApiErrorCode
import com.andrewtinyakov.fileupload.shared.web.badRequest

private val ulidPattern = Regex("^[0-7][0-9A-HJKMNP-TV-Z]{25}$")

@JvmInline
value class UserId(
    val value: String,
)

fun validateUserId(userId: String): UserId {
    if (!ulidPattern.matches(userId)) {
        badRequest(
            code = ApiErrorCode.INVALID_USER_ID,
            message = "X-User-ID must be a ULID",
        )
    }
    return UserId(userId)
}
