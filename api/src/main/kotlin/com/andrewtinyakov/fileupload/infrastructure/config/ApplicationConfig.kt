package com.andrewtinyakov.fileupload.infrastructure.config

import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.servlet.config.annotation.CorsRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer
import java.time.Clock

@ConfigurationProperties("file-upload.web")
data class WebProperties(
    val allowedOrigins: List<String> = listOf("http://localhost:5173"),
)

@Configuration(proxyBeanMethods = false)
class ApplicationConfig(
    private val properties: WebProperties,
) : WebMvcConfigurer {
    @Bean
    fun clock(): Clock = Clock.systemUTC()

    override fun addCorsMappings(registry: CorsRegistry) {
        registry
            .addMapping("/**")
            .allowedOrigins(*properties.allowedOrigins.toTypedArray())
            .allowedMethods(
                "GET",
                "POST",
                "OPTIONS",
            ).allowedHeaders(
                "Content-Type",
                "X-User-ID",
                "Idempotency-Key",
            ).exposedHeaders("Location")
            .maxAge(3600)
    }
}
