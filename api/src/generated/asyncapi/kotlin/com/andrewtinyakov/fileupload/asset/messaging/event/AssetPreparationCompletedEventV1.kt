package com.andrewtinyakov.fileupload.asset.messaging.event

@javax.annotation.processing.Generated("contracts/generate-models.mjs")
data class AssetPreparationCompletedEventV1(
    val commandId: String,
    val assetId: String,
    val preparationStartedAt: java.time.OffsetDateTime,
    val workerStartedAt: java.time.OffsetDateTime,
    val workerFinishedAt: java.time.OffsetDateTime,
    val variants: List<AssetVariantV1>,
)
