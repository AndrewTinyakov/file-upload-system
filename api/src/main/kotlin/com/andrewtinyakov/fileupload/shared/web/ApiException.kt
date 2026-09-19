package com.andrewtinyakov.fileupload.shared.web

import org.springframework.http.HttpStatus

class ApiException(
    val status: HttpStatus,
    val code: ApiErrorCode,
    override val message: String,
) : RuntimeException(message)

fun notFound(): Nothing =
    throw ApiException(
        HttpStatus.NOT_FOUND,
        ApiErrorCode.NOT_FOUND,
        "The requested resource was not found",
    )

fun conflict(
    code: ApiErrorCode,
    message: String,
): Nothing =
    throw ApiException(
        HttpStatus.CONFLICT,
        code,
        message,
    )

fun badRequest(
    code: ApiErrorCode,
    message: String,
): Nothing =
    throw ApiException(
        HttpStatus.BAD_REQUEST,
        code,
        message,
    )
