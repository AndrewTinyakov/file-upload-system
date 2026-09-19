package com.andrewtinyakov.fileupload.shared.crypto

import java.security.MessageDigest

fun sha256Hex(value: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(value).joinToString("") { "%02x".format(it) }
