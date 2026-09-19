package com.andrewtinyakov.fileupload.asset.integration.s3

import com.andrewtinyakov.fileupload.asset.integration.StorageProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.S3Configuration
import software.amazon.awssdk.services.s3.presigner.S3Presigner
import java.time.Duration

@Configuration(proxyBeanMethods = false)
class S3Config {
    @Bean
    fun s3Client(properties: StorageProperties): S3Client =
        S3Client
            .builder()
            .endpointOverride(properties.endpoint)
            .region(Region.of(properties.region))
            .credentialsProvider(
                StaticCredentialsProvider.create(
                    AwsBasicCredentials.create(
                        properties.accessKey,
                        properties.secretKey,
                    ),
                ),
            ).serviceConfiguration(
                S3Configuration.builder().pathStyleAccessEnabled(properties.pathStyleAccess).build(),
            ).httpClientBuilder(
                UrlConnectionHttpClient
                    .builder()
                    .connectionTimeout(Duration.ofSeconds(5))
                    .socketTimeout(Duration.ofSeconds(30)),
            ).overrideConfiguration {
                it.apiCallTimeout(Duration.ofSeconds(45)).apiCallAttemptTimeout(Duration.ofSeconds(30))
            }.build()

    @Bean
    fun s3Presigner(properties: StorageProperties): S3Presigner =
        S3Presigner
            .builder()
            .endpointOverride(properties.publicEndpoint)
            .region(Region.of(properties.region))
            .credentialsProvider(
                StaticCredentialsProvider.create(
                    AwsBasicCredentials.create(
                        properties.accessKey,
                        properties.secretKey,
                    ),
                ),
            ).serviceConfiguration(
                S3Configuration
                    .builder()
                    .pathStyleAccessEnabled(properties.pathStyleAccess)
                    .checksumValidationEnabled(false)
                    .build(),
            ).build()
}
