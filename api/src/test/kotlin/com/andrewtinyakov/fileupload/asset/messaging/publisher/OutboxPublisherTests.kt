package com.andrewtinyakov.fileupload.asset.messaging.publisher

import com.andrewtinyakov.fileupload.asset.messaging.command.AbortMultipartUploadCommandV1
import com.andrewtinyakov.fileupload.asset.model.AssetStatus
import com.andrewtinyakov.fileupload.asset.model.FileAsset
import com.andrewtinyakov.fileupload.asset.model.FileAssetId
import com.andrewtinyakov.fileupload.asset.model.HandlingMode
import com.andrewtinyakov.fileupload.infrastructure.config.SchedulingProperties
import com.andrewtinyakov.fileupload.infrastructure.outbox.JooqOutboxRepository
import com.andrewtinyakov.fileupload.infrastructure.outbox.OutboxConfig
import com.andrewtinyakov.fileupload.infrastructure.outbox.OutboxService
import com.andrewtinyakov.fileupload.shared.id.UlidGenerator
import com.andrewtinyakov.fileupload.user.UserId
import org.jooq.SQLDialect
import org.jooq.impl.DSL
import org.jooq.tools.jdbc.MockConnection
import org.jooq.tools.jdbc.MockExecuteContext
import org.jooq.tools.jdbc.MockResult
import org.junit.jupiter.api.Test
import org.springframework.amqp.rabbit.core.RabbitTemplate
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.ObjectMapper
import java.time.Clock
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class OutboxPublisherTests {
    private val executions = mutableListOf<MockExecuteContext>()
    private val mapper = ObjectMapper()
    private val connection = MockConnection { context ->
        executions.add(context)
        arrayOf(MockResult(3))
    }
    private val outbox = OutboxService(
        repository = JooqOutboxRepository(DSL.using(connection, SQLDialect.POSTGRES)),
        transactions = TransactionTemplate(),
        rabbit = RabbitTemplate(),
        schedulingProperties = SchedulingProperties(),
        config = OutboxConfig(),
        clock = Clock.systemUTC(),
        mapper = mapper,
    )
    private val cleanup = AssetCleanupPublisher(outbox, UlidGenerator())
    private val abort = MultipartUploadAbortPublisher(outbox)

    @Test
    fun `cleanup publisher stores all delete commands in one batch`() {
        val assets = (1..3).map { index ->
            FileAsset(
                id = FileAssetId("asset-$index"),
                ownerId = UserId("owner"),
                filename = "document.txt",
                contentType = "text/plain",
                byteSize = 5,
                handlingMode = HandlingMode.DOCUMENT,
                processingProfileName = null,
                processingProfileVersion = null,
                status = AssetStatus.DISCARDED,
                failureCode = "RETRY_EXHAUSTED",
                bucket = "assets",
                prefix = "assets/asset-$index/",
            )
        }

        cleanup.enqueueCleanup(assets)

        assertEquals(1, executions.size)
        val rows = executions.single().bindings().toList().chunked(7)
        assertEquals(3, rows.size)
        assertEquals(3, rows.map { it[0] }.distinct().size)
        rows.zip(assets).forEach { (row, asset) ->
            assertEquals("FileAsset", row[1])
            assertEquals(asset.id.value, row[2])
            assertEquals("DeleteAssetPrefixCommandV1", row[3])
            assertEquals("asset.commands", row[4])
            assertEquals("asset.prefix.delete.v1", row[5])
            val payload = mapper.readTree(row[6].toString())
            assertEquals(row[0], payload["commandId"].stringValue())
            assertEquals(asset.id.value, payload["assetId"].stringValue())
            assertEquals(asset.prefix, payload["prefix"].stringValue())
        }
    }

    @Test
    fun `abort publisher stores all abort commands in one batch`() {
        val commands = (1..3).map { index ->
            AbortMultipartUploadCommandV1(
                commandId = "command-$index",
                uploadSessionId = "session-$index",
                bucket = "uploads",
                objectKey = "uploads/object-$index",
                uploadId = "provider-$index",
            )
        }

        abort.enqueueAborts(commands)

        assertEquals(1, executions.size)
        val rows = executions.single().bindings().toList().chunked(7)
        assertEquals(3, rows.size)
        rows.zip(commands).forEach { (row, command) ->
            assertEquals(command.commandId, row[0])
            assertEquals("UploadSession", row[1])
            assertEquals(command.uploadSessionId, row[2])
            assertEquals("AbortMultipartUploadCommandV1", row[3])
            assertEquals("asset.commands", row[4])
            assertEquals("upload.multipart.abort.v1", row[5])
            val payload = mapper.readTree(row[6].toString())
            assertEquals(command.commandId, payload["commandId"].stringValue())
            assertEquals(command.uploadSessionId, payload["uploadSessionId"].stringValue())
            assertEquals(command.bucket, payload["bucket"].stringValue())
            assertEquals(command.objectKey, payload["objectKey"].stringValue())
            assertEquals(command.uploadId, payload["uploadId"].stringValue())
        }
    }

    @Test
    fun `empty publisher batch writes nothing`() {
        cleanup.enqueueCleanup(emptyList())
        abort.enqueueAborts(emptyList())

        assertTrue(executions.isEmpty())
    }
}
