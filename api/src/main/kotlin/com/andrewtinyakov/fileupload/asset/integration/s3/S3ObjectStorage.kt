package com.andrewtinyakov.fileupload.asset.integration.s3

import com.andrewtinyakov.fileupload.asset.integration.ObjectStorage
import com.andrewtinyakov.fileupload.asset.integration.StorageProperties
import com.andrewtinyakov.fileupload.asset.integration.dto.MultipartPart
import com.andrewtinyakov.fileupload.asset.integration.dto.PresignedRequest
import com.andrewtinyakov.fileupload.asset.integration.dto.StoredObjectMetadata
import com.andrewtinyakov.fileupload.shared.integration.DependencyUnavailableException
import com.andrewtinyakov.fileupload.shared.web.ApiErrorCode
import com.andrewtinyakov.fileupload.shared.web.conflict
import org.springframework.stereotype.Component
import software.amazon.awssdk.core.exception.SdkException
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.S3Configuration
import software.amazon.awssdk.services.s3.S3Utilities
import software.amazon.awssdk.services.s3.model.ObjectIdentifier
import software.amazon.awssdk.services.s3.model.S3Exception
import software.amazon.awssdk.services.s3.presigner.S3Presigner
import java.net.URLEncoder
import java.time.Duration
import software.amazon.awssdk.services.s3.model.CompletedPart as StorageCompletedPart

@Component
class S3ObjectStorage(
    private val s3: S3Client,
    private val presigner: S3Presigner,
    private val properties: StorageProperties,
) : ObjectStorage {
    private val publicUrls = S3Utilities
        .builder()
        .endpoint(properties.publicEndpoint)
        .region(Region.of(properties.region))
        .s3Configuration(
            S3Configuration.builder().pathStyleAccessEnabled(properties.pathStyleAccess).build(),
        ).build()

    override fun getPublicUrl(
        bucket: String,
        objectKey: String,
    ): String {
        val baseUrl = properties.publicAssetsBaseUrl
        if (baseUrl != null && bucket == properties.assetsBucket) {
            return baseUrl.trimEnd('/') + "/" + objectKey.split('/').joinToString("/") {
                URLEncoder
                    .encode(
                        it,
                        Charsets.UTF_8,
                    ).replace(
                        "+",
                        "%20",
                    )
            }
        }
        return translateSdkException {
            publicUrls.getUrl { it.bucket(bucket).key(objectKey) }.toExternalForm()
        }
    }

    override fun deleteByPrefix(
        bucket: String,
        prefix: String,
    ) = translateSdkException {
        require(prefix.isNotBlank() && prefix.endsWith('/'))
        for (page in s3.listObjectsV2Paginator { it.bucket(bucket).prefix(prefix) }) {
            if (page.contents().isEmpty()) {
                continue
            }
            val deleted = s3.deleteObjects {
                it.bucket(bucket).delete { deletion ->
                    deletion.objects(
                        page.contents().map { item ->
                            ObjectIdentifier.builder().key(item.key()).build()
                        },
                    )
                }
            }
            val errors = deleted.errors()
            check(errors.isEmpty()) { "Some asset objects could not be deleted" }
        }
    }

    override fun presignPart(
        bucket: String,
        objectKey: String,
        uploadId: String,
        partNumber: Int,
        lifetime: Duration,
    ): PresignedRequest {
        val signed = translateSdkException {
            presigner.presignUploadPart {
                it.signatureDuration(lifetime).uploadPartRequest { request ->
                    request
                        .bucket(bucket)
                        .key(objectKey)
                        .uploadId(uploadId)
                        .partNumber(partNumber)
                }
            }
        }
        return PresignedRequest(
            signed.url().toString(),
            "PUT",
            signed
                .signedHeaders()
                .filterKeys {
                    !it.equals(
                        "host",
                        true,
                    )
                }.mapValues { it.value.joinToString(",") },
        )
    }

    override fun completeMultipartUpload(
        bucket: String,
        objectKey: String,
        uploadId: String,
        parts: List<MultipartPart>,
    ) {
        runCatching {
            s3.completeMultipartUpload {
                it.bucket(bucket).key(objectKey).uploadId(uploadId).multipartUpload { upload ->
                    upload.parts(
                        parts.map { part ->
                            StorageCompletedPart
                                .builder()
                                .partNumber(part.partNumber)
                                .eTag(part.etag)
                                .build()
                        },
                    )
                }
            }
        }.getOrElse { exception ->
            when (exception) {
                is S3Exception -> {
                    when (exception.awsErrorDetails()?.errorCode()) {
                        "NoSuchUpload" -> {
                            getMetadata(
                                bucket = bucket,
                                objectKey = objectKey,
                            )
                            Unit
                        }

                        "InvalidPart",
                        "InvalidPartOrder",
                        "EntityTooSmall",
                        -> {
                            conflict(
                                code = ApiErrorCode.INVALID_PARTS,
                                message = "The uploaded parts do not match the completion request",
                            )
                        }

                        else -> {
                            throwForSdkException(exception)
                        }
                    }
                }

                is SdkException -> {
                    throwForSdkException(exception)
                }

                else -> {
                    throw exception
                }
            }
        }
    }

    override fun getMetadata(
        bucket: String,
        objectKey: String,
    ): StoredObjectMetadata =
        runCatching {
            val response = s3.headObject { it.bucket(bucket).key(objectKey) }
            StoredObjectMetadata(
                response.contentLength(),
                response.eTag(),
            )
        }.getOrElse { exception ->
            when (exception) {
                is S3Exception -> {
                    if (exception.statusCode() == 404) {
                        conflict(
                            code = ApiErrorCode.UPLOAD_NOT_FOUND,
                            message = "Upload the object before completing the session",
                        )
                    }
                    throwForSdkException(exception)
                }

                is SdkException -> {
                    throwForSdkException(exception)
                }

                else -> {
                    throw exception
                }
            }
        }

    override fun startMultipart(
        bucket: String,
        key: String,
        contentType: String,
    ): String =
        translateSdkException {
            s3.createMultipartUpload { it.bucket(bucket).key(key).contentType(contentType) }.uploadId()
        }

    override fun abortMultipart(
        bucket: String,
        objectKey: String,
        uploadId: String,
    ) {
        runCatching {
            s3.abortMultipartUpload {
                it.bucket(bucket).key(objectKey).uploadId(uploadId)
            }
        }.getOrElse { exception ->
            when (exception) {
                is S3Exception -> {
                    if (exception.awsErrorDetails()?.errorCode() != "NoSuchUpload") {
                        throwForSdkException(exception)
                    }
                }

                is SdkException -> {
                    throwForSdkException(exception)
                }

                else -> {
                    throw exception
                }
            }
        }
    }

    override fun presignPut(
        bucket: String,
        objectKey: String,
        contentType: String,
        byteSize: Long,
        lifetime: Duration,
    ): PresignedRequest {
        val signed = translateSdkException {
            presigner.presignPutObject {
                it.signatureDuration(lifetime).putObjectRequest { request ->
                    request
                        .bucket(bucket)
                        .key(objectKey)
                        .contentType(contentType)
                        .contentLength(byteSize)
                }
            }
        }
        return PresignedRequest(
            signed.url().toString(),
            "PUT",
            signed
                .signedHeaders()
                .filterKeys {
                    !it.equals(
                        "host",
                        true,
                    )
                }.mapValues { it.value.joinToString(",") },
        )
    }

    private inline fun <T> translateSdkException(block: () -> T): T =
        runCatching { block() }.getOrElse { exception ->
            if (exception is SdkException) {
                throwForSdkException(exception)
            }
            throw exception
        }

    private fun throwForSdkException(exception: SdkException): Nothing {
        if (exception.retryable()) {
            throw DependencyUnavailableException(
                "object storage",
                exception,
            )
        }
        throw exception
    }
}
