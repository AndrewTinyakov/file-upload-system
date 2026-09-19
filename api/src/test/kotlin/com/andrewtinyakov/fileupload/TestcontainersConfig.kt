package com.andrewtinyakov.fileupload

import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.testcontainers.service.connection.ServiceConnection
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary
import org.springframework.test.context.DynamicPropertyRegistrar
import org.testcontainers.containers.GenericContainer
import org.testcontainers.containers.wait.strategy.Wait
import org.testcontainers.postgresql.PostgreSQLContainer
import org.testcontainers.rabbitmq.RabbitMQContainer
import org.testcontainers.utility.DockerImageName

@TestConfiguration(proxyBeanMethods = false)
class TestcontainersConfig {
    @Bean
    @Primary
    fun testClock(): MutableClock = MutableClock()

    @Bean
    fun minioContainer(): GenericContainer<*> =
        GenericContainer(DockerImageName.parse("quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z"))
            .withEnv(
                "MINIO_ROOT_USER",
                "file_upload",
            ).withEnv(
                "MINIO_ROOT_PASSWORD",
                "file_upload",
            ).withCommand(
                "server",
                "/data",
            ).withExposedPorts(9000)
            .waitingFor(Wait.forHttp("/minio/health/live").forPort(9000))

    @Bean
    fun storageProperties(
        @Qualifier("minioContainer") minio: GenericContainer<*>,
    ): DynamicPropertyRegistrar =
        DynamicPropertyRegistrar { registry ->
            registry.add("file-upload.storage.endpoint") {
                "http://${minio.host}:${minio.getMappedPort(9000)}"
            }
        }

    @Bean
    @ServiceConnection
    fun postgresContainer(): PostgreSQLContainer = PostgreSQLContainer(DockerImageName.parse("postgres:18.6"))

    @Bean
    @ServiceConnection
    fun rabbitContainer(): RabbitMQContainer = RabbitMQContainer(DockerImageName.parse("rabbitmq:4.3.5-management"))
}
