package com.andrewtinyakov.fileupload.asset.web.controller

import com.andrewtinyakov.fileupload.asset.model.UploadSessionId
import com.andrewtinyakov.fileupload.asset.service.UploadSessionActionsService
import com.andrewtinyakov.fileupload.asset.service.UploadSessionService
import com.andrewtinyakov.fileupload.asset.web.payload.CompleteUploadSessionRequest
import com.andrewtinyakov.fileupload.asset.web.payload.CreateUploadSessionRequest
import com.andrewtinyakov.fileupload.asset.web.payload.SignPartsRequest
import com.andrewtinyakov.fileupload.user.validateUserId
import jakarta.validation.Valid
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.net.URI

@RestController
@RequestMapping("/v1/upload-sessions")
class UploadSessionController(
    private val uploadSessionService: UploadSessionService,
    private val uploadSessionActions: UploadSessionActionsService,
) {
    @PostMapping
    fun create(
        @RequestHeader("X-User-ID") userId: String,
        @RequestHeader("Idempotency-Key") idempotencyKey: String,
        @Valid @RequestBody request: CreateUploadSessionRequest,
    ): ResponseEntity<*> {
        val response = uploadSessionService.create(
            userId = validateUserId(userId),
            idempotencyKey = idempotencyKey,
            request = request,
        )
        return ResponseEntity
            .created(
                URI("/api/v1/upload-sessions/${response.sessionId.value}"),
            ).body(response)
    }

    @PostMapping("/{sessionId}/abort")
    fun abort(
        @RequestHeader("X-User-ID") userId: String,
        @PathVariable sessionId: String,
    ) = uploadSessionActions.abort(
        userId = validateUserId(userId),
        sessionId = UploadSessionId(sessionId),
    )

    @PostMapping("/{sessionId}/parts")
    fun presignParts(
        @RequestHeader("X-User-ID") userId: String,
        @PathVariable sessionId: String,
        @RequestBody request: SignPartsRequest,
    ) = uploadSessionActions.presignParts(
        userId = validateUserId(userId),
        sessionId = UploadSessionId(sessionId),
        request = request,
    )

    @PostMapping("/{sessionId}/complete")
    fun complete(
        @RequestHeader("X-User-ID") userId: String,
        @PathVariable sessionId: String,
        @RequestBody(required = false) request: CompleteUploadSessionRequest?,
    ): ResponseEntity<*> =
        ResponseEntity.accepted().body(
            uploadSessionActions.complete(
                userId = validateUserId(userId),
                sessionId = UploadSessionId(sessionId),
                request = request ?: CompleteUploadSessionRequest(),
            ),
        )

    @GetMapping("/{sessionId}")
    fun getSession(
        @RequestHeader("X-User-ID") userId: String,
        @PathVariable sessionId: String,
    ) = uploadSessionService.getSession(
        userId = validateUserId(userId),
        sessionId = UploadSessionId(sessionId),
    )
}
