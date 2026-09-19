package com.andrewtinyakov.fileupload.asset.repository

import com.andrewtinyakov.fileupload.asset.model.AssetVariant
import com.andrewtinyakov.fileupload.asset.model.FileAssetId
import com.andrewtinyakov.fileupload.asset.model.VariantType
import com.andrewtinyakov.fileupload.infrastructure.database.generated.enums.AssetVariantType
import com.andrewtinyakov.fileupload.infrastructure.database.generated.tables.AssetVariants.ASSET_VARIANTS
import com.andrewtinyakov.fileupload.infrastructure.database.generated.tables.records.AssetVariantsRecord
import com.andrewtinyakov.fileupload.shared.id.UlidGenerator
import org.jooq.DSLContext
import org.springframework.stereotype.Repository

@Repository
class JooqAssetVariantRepository(
    private val db: DSLContext,
    private val ulidGenerator: UlidGenerator,
) : AssetVariantRepository {
    override fun findByAssetId(assetId: FileAssetId): List<AssetVariant> =
        db
            .selectFrom(ASSET_VARIANTS)
            .where(ASSET_VARIANTS.FILE_ASSET_ID.eq(assetId.value))
            .orderBy(ASSET_VARIANTS.VARIANT_TYPE)
            .fetch()
            .map { it.toModel() }

    override fun insert(
        assetId: FileAssetId,
        variants: List<AssetVariant>,
    ) {
        variants.forEach { variant ->
            val inserted = db
                .insertInto(ASSET_VARIANTS)
                .set(
                    ASSET_VARIANTS.ID,
                    ulidGenerator.generate(),
                ).set(
                    ASSET_VARIANTS.FILE_ASSET_ID,
                    assetId.value,
                ).set(
                    ASSET_VARIANTS.VARIANT_TYPE,
                    AssetVariantType.valueOf(variant.type.name),
                ).set(
                    ASSET_VARIANTS.BUCKET,
                    variant.bucket,
                ).set(
                    ASSET_VARIANTS.OBJECT_KEY,
                    variant.objectKey,
                ).set(
                    ASSET_VARIANTS.CONTENT_TYPE,
                    variant.contentType,
                ).set(
                    ASSET_VARIANTS.BYTE_SIZE,
                    variant.byteSize,
                ).set(
                    ASSET_VARIANTS.WIDTH,
                    variant.width,
                ).set(
                    ASSET_VARIANTS.HEIGHT,
                    variant.height,
                ).execute()
            check(inserted == 1)
        }
    }
}

private fun AssetVariantsRecord.toModel() =
    AssetVariant(
        type = VariantType.valueOf(variantType!!.name),
        bucket = bucket!!,
        objectKey = objectKey!!,
        contentType = contentType!!,
        byteSize = byteSize!!,
        width = width,
        height = height,
    )
