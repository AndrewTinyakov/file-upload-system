package com.andrewtinyakov.fileupload.infrastructure.config

import org.springframework.boot.security.autoconfigure.actuate.web.servlet.EndpointRequest
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.annotation.Order
import org.springframework.security.config.Customizer
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.web.SecurityFilterChain

@Configuration(proxyBeanMethods = false)
class MonitoringSecurityConfig {
    @Bean
    @Order(1)
    fun monitoringSecurityFilterChain(http: HttpSecurity): SecurityFilterChain {
        http
            .securityMatcher(EndpointRequest.toAnyEndpoint())
            .authorizeHttpRequests { requests ->
                requests.requestMatchers(EndpointRequest.to("health")).permitAll()
                requests.anyRequest().hasRole("MONITORING")
            }.httpBasic(Customizer.withDefaults())
            .csrf { csrf -> csrf.disable() }
        return http.build()
    }

    @Bean
    @Order(2)
    fun applicationSecurityFilterChain(http: HttpSecurity): SecurityFilterChain {
        http
            .authorizeHttpRequests { requests -> requests.anyRequest().permitAll() }
            .csrf { csrf -> csrf.disable() }
        return http.build()
    }
}
