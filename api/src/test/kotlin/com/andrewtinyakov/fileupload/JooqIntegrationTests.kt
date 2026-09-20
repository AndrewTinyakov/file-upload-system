package com.andrewtinyakov.fileupload

import com.andrewtinyakov.fileupload.infrastructure.database.generated.enums.FileAssetStatus
import com.andrewtinyakov.fileupload.infrastructure.database.generated.enums.FileHandlingMode
import com.andrewtinyakov.fileupload.infrastructure.database.generated.tables.FileAssets.FILE_ASSETS
import com.github.f4b6a3.ulid.UlidCreator
import org.jooq.DSLContext
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.transaction.support.TransactionTemplate
import kotlin.test.assertEquals

@Import(TestcontainersConfig::class)
@SpringBootTest
class JooqIntegrationTests
    @Autowired
    constructor(
        private val db: DSLContext,
        private val tx: TransactionTemplate,
    ) {
        @Test
        fun `file asset starts as awaiting upload`() =
            tx.executeWithoutResult { status ->
                val assetId = UlidCreator.getMonotonicUlid().toString()
                val ownerId = UlidCreator.getMonotonicUlid().toString()

                val inserted =
                    db
                        .insertInto(FILE_ASSETS)
                        .set(
                            FILE_ASSETS.ID,
                            assetId,
                        ).set(
                            FILE_ASSETS.OWNER_ID,
                            ownerId,
                        ).set(
                            FILE_ASSETS.ORIGINAL_FILENAME,
                            "contract.pdf",
                        ).set(
                            FILE_ASSETS.CONTENT_TYPE,
                            "application/pdf",
                        ).set(
                            FILE_ASSETS.BYTE_SIZE,
                            1024,
                        ).set(
                            FILE_ASSETS.HANDLING_MODE,
                            FileHandlingMode.DOCUMENT,
                        ).set(
                            FILE_ASSETS.BUCKET,
                            "assets",
                        ).set(
                            FILE_ASSETS.PREFIX,
                            "assets/$assetId/",
                        ).returning(
                            FILE_ASSETS.ID,
                            FILE_ASSETS.STATUS,
                        ).fetchSingle()

                assertEquals(
                    FileAssetStatus.AWAITING_UPLOAD,
                    inserted.get(FILE_ASSETS.STATUS),
                )
                status.setRollbackOnly()
            }
    }
