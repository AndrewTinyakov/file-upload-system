FROM eclipse-temurin:25.0.1_8-jre-noble
WORKDIR /app
COPY api/build/libs/api-0.0.1-SNAPSHOT.jar app.jar
USER 10001:10001
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=65", "-jar", "app.jar"]
