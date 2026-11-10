package com.andrewtinyakov.fileupload.infrastructure.outbox

import io.micrometer.core.instrument.simple.SimpleMeterRegistry
import org.jooq.DSLContext
import org.mockito.Mockito
import org.springframework.boot.test.context.runner.ApplicationContextRunner
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class UploadPipelineBacklogMetricsTests {
    private val context =
        ApplicationContextRunner()
            .withBean(DSLContext::class.java, { Mockito.mock(DSLContext::class.java) })
            .withBean(SimpleMeterRegistry::class.java, { SimpleMeterRegistry() })
            .withUserConfiguration(UploadPipelineBacklogMetrics::class.java)

    @Test
    fun `backlog database sampler is absent by default`() {
        context.run {
            assertNull(it.startupFailure)
            assertEquals(0, it.getBeansOfType(UploadPipelineBacklogMetrics::class.java).size)
            assertNull(it.getBean(SimpleMeterRegistry::class.java).find("file.upload.preparing").gauge())
        }
    }

    @Test
    fun `benchmark can explicitly enable backlog observations`() {
        context.withPropertyValues("file-upload.monitoring.backlog-enabled=true").run {
            assertNull(it.startupFailure)
            assertEquals(1, it.getBeansOfType(UploadPipelineBacklogMetrics::class.java).size)
            assertNotNull(it.getBean(SimpleMeterRegistry::class.java).find("file.upload.preparing").gauge())
        }
    }
}
