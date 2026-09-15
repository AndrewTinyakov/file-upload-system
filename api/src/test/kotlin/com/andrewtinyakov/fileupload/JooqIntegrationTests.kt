package com.andrewtinyakov.fileupload

import com.andrewtinyakov.fileupload.infrastructure.database.generated.enums.FileAssetStatus
import com.andrewtinyakov.fileupload.infrastructure.database.generated.enums.FileHandlingMode
import com.andrewtinyakov.fileupload.infrastructure.database.generated.tables.FileAssets.FILE_ASSETS
import com.github.f4b6a3.ulid.UlidCreator
import org.jooq.DSLContext
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.transaction.annotation.Transactional

@Import(TestcontainersConfiguration::class)
@SpringBootTest
class JooqIntegrationTests @Autowired constructor(
    private val db: DSLContext,
) {

    @Test
    @Transactional
    fun `generated schema inserts and reads a file asset`() {
        val assetId = UlidCreator.getMonotonicUlid().toString()
        val ownerId = UlidCreator.getMonotonicUlid().toString()

        val inserted = db.insertInto(FILE_ASSETS)
            .set(FILE_ASSETS.ID, assetId)
            .set(FILE_ASSETS.OWNER_ID, ownerId)
            .set(FILE_ASSETS.ORIGINAL_FILENAME, "contract.pdf")
            .set(FILE_ASSETS.CONTENT_TYPE, "application/pdf")
            .set(FILE_ASSETS.BYTE_SIZE, 1024)
            .set(FILE_ASSETS.HANDLING_MODE, FileHandlingMode.DOCUMENT)
            .set(FILE_ASSETS.BUCKET, "assets")
            .set(FILE_ASSETS.PREFIX, "assets/$assetId/")
            .returning(FILE_ASSETS.ID, FILE_ASSETS.STATUS)
            .fetchSingle()

        assertEquals(assetId, inserted.get(FILE_ASSETS.ID))
        assertEquals(FileAssetStatus.AWAITING_UPLOAD, inserted.get(FILE_ASSETS.STATUS))

        val storedFilename = db.select(FILE_ASSETS.ORIGINAL_FILENAME)
            .from(FILE_ASSETS)
            .where(FILE_ASSETS.ID.eq(assetId))
            .fetchSingle(FILE_ASSETS.ORIGINAL_FILENAME)

        assertEquals("contract.pdf", storedFilename)
    }
}
