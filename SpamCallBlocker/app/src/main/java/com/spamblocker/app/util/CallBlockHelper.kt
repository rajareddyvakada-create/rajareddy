package com.spamblocker.app.util

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.ContactsContract
import android.telecom.TelecomManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.spamblocker.app.R
import com.spamblocker.app.data.SpamDatabase

data class BlockResult(
    val shouldBlock: Boolean,
    val reason: String = "",
    val spamName: String = "",
    val category: String = ""
)

object CallBlockHelper {

    private const val TAG = "CallBlockHelper"
    private const val CHANNEL_ID = "spam_blocked"
    private var notificationId = 1000

    /**
     * Core decision engine: checks whether an incoming call should be blocked.
     * Checks in order:
     * 1. Whitelist (always allow)
     * 2. Contacts (always allow unless whitelist-only mode)
     * 3. Direct number match in blocklist
     * 4. Pattern match (140*, 1800* prefixes)
     * 5. Category-based settings (telecom, credit, real estate)
     * 6. International number detection
     */
    fun shouldBlockCall(db: SpamDatabase, number: String, context: Context): BlockResult {
        val cleaned = number.replace(" ", "").replace("-", "")

        // Always allow whitelisted numbers
        if (db.isWhitelisted(cleaned)) {
            return BlockResult(shouldBlock = false, reason = "Whitelisted")
        }

        // Always allow saved contacts
        if (isContact(context, cleaned)) {
            return BlockResult(shouldBlock = false, reason = "Saved contact")
        }

        // Whitelist-only mode: block everything that isn't a contact or whitelisted
        if (db.isWhitelistOnly()) {
            return BlockResult(
                shouldBlock = true,
                reason = "Whitelist-only mode — not in contacts",
                spamName = "Unknown Caller",
                category = "custom"
            )
        }

        // Check spam database (direct + pattern match)
        val spamMatch = db.isSpamNumber(cleaned)
        if (spamMatch != null) {
            val categoryEnabled = when (spamMatch.category) {
                "telecom" -> db.isBlockTelecom()
                "credit" -> db.isBlockCredit()
                "realestate" -> db.isBlockRealEstate()
                else -> true
            }
            if (categoryEnabled) {
                return BlockResult(
                    shouldBlock = true,
                    reason = if (spamMatch.isPattern) "Matched prefix pattern: ${spamMatch.number}*"
                             else "In spam database (${spamMatch.reports} reports)",
                    spamName = spamMatch.name,
                    category = spamMatch.category
                )
            }
        }

        // Block 140-prefix telemarketers (even if not in DB)
        if (db.isBlockPrefix140()) {
            val noCode = cleaned.removePrefix("+91").removePrefix("91").removePrefix("0")
            if (noCode.startsWith("140") || noCode.startsWith("1800")) {
                return BlockResult(
                    shouldBlock = true,
                    reason = "Telemarketing prefix detected",
                    spamName = "Telemarketer (${noCode.take(4)}...)",
                    category = "telecom"
                )
            }
        }

        // Block unknown international numbers
        if (db.isBlockInternational()) {
            if (cleaned.startsWith("+") && !cleaned.startsWith("+91")) {
                return BlockResult(
                    shouldBlock = true,
                    reason = "International number blocked",
                    spamName = "International (${cleaned.take(5)}...)",
                    category = "custom"
                )
            }
        }

        return BlockResult(shouldBlock = false)
    }

    /**
     * Check if a number exists in the phone's contacts.
     */
    private fun isContact(context: Context, number: String): Boolean {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS)
            != PackageManager.PERMISSION_GRANTED) {
            return false
        }
        val uri = android.net.Uri.withAppendedPath(
            ContactsContract.PhoneLookup.CONTENT_FILTER_URI,
            android.net.Uri.encode(number)
        )
        val cursor = try {
            context.contentResolver.query(uri, arrayOf(ContactsContract.PhoneLookup._ID), null, null, null)
        } catch (e: Exception) {
            null
        }
        val isContact = cursor?.moveToFirst() == true
        cursor?.close()
        return isContact
    }

    /**
     * End the current ringing call. Uses TelecomManager on API 28+.
     */
    fun endCall(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val telecomManager = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.ANSWER_PHONE_CALLS)
                == PackageManager.PERMISSION_GRANTED) {
                try {
                    telecomManager.endCall()
                    Log.d(TAG, "Call ended via TelecomManager")
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to end call: ${e.message}")
                }
            }
        } else {
            // Pre-API 28 fallback using ITelephony reflection
            try {
                val telephonyService = context.getSystemService(Context.TELEPHONY_SERVICE)
                val telephonyClass = Class.forName(telephonyService.javaClass.name)
                val method = telephonyClass.getDeclaredMethod("getITelephony")
                method.isAccessible = true
                val iTelephony = method.invoke(telephonyService)
                val endCallMethod = iTelephony.javaClass.getDeclaredMethod("endCall")
                endCallMethod.invoke(iTelephony)
                Log.d(TAG, "Call ended via ITelephony reflection")
            } catch (e: Exception) {
                Log.e(TAG, "Reflection call end failed: ${e.message}")
            }
        }
    }

    /**
     * Show a notification that a spam call was blocked.
     */
    fun showBlockedNotification(context: Context, number: String, name: String, category: String) {
        createNotificationChannel(context)

        val categoryLabel = when (category) {
            "telecom" -> "Telecom Spam"
            "credit" -> "Credit Card/Loan Spam"
            "realestate" -> "Real Estate Spam"
            else -> "Spam Call"
        }

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_block)
            .setContentTitle("Blocked: $categoryLabel")
            .setContentText("$name ($number)")
            .setSubText("Spam Call Blocker")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setAutoCancel(true)
            .build()

        if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED) {
            NotificationManagerCompat.from(context).notify(notificationId++, notification)
        }
    }

    private fun createNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Blocked Spam Calls",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Notifications when a spam call is automatically blocked"
            }
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }
}
