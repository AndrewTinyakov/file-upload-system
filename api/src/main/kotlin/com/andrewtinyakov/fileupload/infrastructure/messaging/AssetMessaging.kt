package com.andrewtinyakov.fileupload.infrastructure.messaging

internal object AssetMessaging {
    object Exchanges {
        const val COMMANDS = "asset.commands"
        const val EVENTS = "asset.events"
        const val DEAD = "asset.dead"
    }

    object Queues {
        const val DOCUMENT_JOBS = "document.jobs"
        const val IMAGE_JOBS = "image.jobs"
        const val ASSET_EVENTS = "backend.asset-events"
        const val PREPARATION_DEAD = "backend.preparation-dead"
        const val ASSET_CLEANUPS = "backend.asset-cleanups"
        const val ASSET_CLEANUPS_DEAD = "backend.asset-cleanups-dead"
        const val MULTIPART_ABORTS = "backend.multipart-aborts"
        const val MULTIPART_ABORTS_DEAD = "backend.multipart-aborts-dead"
    }

    object RoutingKeys {
        const val PREPARE_DOCUMENT = "document.prepare.v1"
        const val PREPARE_IMAGE = "image.prepare.v1"
        const val PREPARATION_COMPLETED = "asset.preparation.completed.v1"
        const val PREPARATION_FAILED = "asset.preparation.failed.v1"
        const val DELETE_ASSET_PREFIX = "asset.prefix.delete.v1"
        const val ABORT_MULTIPART_UPLOAD = "upload.multipart.abort.v1"
    }

    object Routes {
        val PREPARE_DOCUMENT = MessageRoute(
            exchange = Exchanges.COMMANDS,
            routingKey = RoutingKeys.PREPARE_DOCUMENT,
        )
        val PREPARE_IMAGE = MessageRoute(
            exchange = Exchanges.COMMANDS,
            routingKey = RoutingKeys.PREPARE_IMAGE,
        )
        val PREPARATION_COMPLETED = MessageRoute(
            exchange = Exchanges.EVENTS,
            routingKey = RoutingKeys.PREPARATION_COMPLETED,
        )
        val PREPARATION_FAILED = MessageRoute(
            exchange = Exchanges.EVENTS,
            routingKey = RoutingKeys.PREPARATION_FAILED,
        )
        val DELETE_ASSET_PREFIX = MessageRoute(
            exchange = Exchanges.COMMANDS,
            routingKey = RoutingKeys.DELETE_ASSET_PREFIX,
        )
        val ABORT_MULTIPART_UPLOAD = MessageRoute(
            exchange = Exchanges.COMMANDS,
            routingKey = RoutingKeys.ABORT_MULTIPART_UPLOAD,
        )
        val DEAD_PREPARE_DOCUMENT = MessageRoute(
            exchange = Exchanges.DEAD,
            routingKey = RoutingKeys.PREPARE_DOCUMENT,
        )
        val DEAD_PREPARE_IMAGE = MessageRoute(
            exchange = Exchanges.DEAD,
            routingKey = RoutingKeys.PREPARE_IMAGE,
        )
        val DEAD_DELETE_ASSET_PREFIX = MessageRoute(
            exchange = Exchanges.DEAD,
            routingKey = RoutingKeys.DELETE_ASSET_PREFIX,
        )
        val DEAD_ABORT_MULTIPART_UPLOAD = MessageRoute(
            exchange = Exchanges.DEAD,
            routingKey = RoutingKeys.ABORT_MULTIPART_UPLOAD,
        )
    }

    val exchanges = listOf(
        Exchanges.COMMANDS,
        Exchanges.EVENTS,
        Exchanges.DEAD,
    )

    val queues = listOf(
        QueueRoute(
            queue = Queues.ASSET_CLEANUPS,
            routes = setOf(Routes.DELETE_ASSET_PREFIX),
            failurePolicy = QueueFailurePolicy.DEAD_LETTER_AFTER_LIMIT,
        ),
        QueueRoute(
            queue = Queues.MULTIPART_ABORTS,
            routes = setOf(Routes.ABORT_MULTIPART_UPLOAD),
            failurePolicy = QueueFailurePolicy.DEAD_LETTER_AFTER_LIMIT,
        ),
        QueueRoute(
            queue = Queues.DOCUMENT_JOBS,
            routes = setOf(Routes.PREPARE_DOCUMENT),
            failurePolicy = QueueFailurePolicy.DEAD_LETTER_AFTER_LIMIT,
        ),
        QueueRoute(
            queue = Queues.IMAGE_JOBS,
            routes = setOf(Routes.PREPARE_IMAGE),
            failurePolicy = QueueFailurePolicy.DEAD_LETTER_AFTER_LIMIT,
        ),
        QueueRoute(
            queue = Queues.ASSET_EVENTS,
            routes = setOf(
                Routes.PREPARATION_COMPLETED,
                Routes.PREPARATION_FAILED,
            ),
            failurePolicy = QueueFailurePolicy.RETRY_INDEFINITELY,
        ),
        QueueRoute(
            queue = Queues.PREPARATION_DEAD,
            routes = setOf(
                Routes.DEAD_PREPARE_DOCUMENT,
                Routes.DEAD_PREPARE_IMAGE,
            ),
            failurePolicy = QueueFailurePolicy.RETRY_INDEFINITELY,
        ),
        QueueRoute(
            queue = Queues.ASSET_CLEANUPS_DEAD,
            routes = setOf(Routes.DEAD_DELETE_ASSET_PREFIX),
            failurePolicy = QueueFailurePolicy.RETRY_INDEFINITELY,
        ),
        QueueRoute(
            queue = Queues.MULTIPART_ABORTS_DEAD,
            routes = setOf(Routes.DEAD_ABORT_MULTIPART_UPLOAD),
            failurePolicy = QueueFailurePolicy.RETRY_INDEFINITELY,
        ),
    )
}
