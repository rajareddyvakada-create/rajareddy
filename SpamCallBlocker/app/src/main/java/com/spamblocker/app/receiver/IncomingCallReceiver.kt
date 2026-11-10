package com.spamblocker.app.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import android.util.Log
import com.spamblocker.app.data.BlockedCallRecord
import com.spamblocker.app.data.SpamDatabase
import com.spamblocker.app.util.CallBlockHelper

/**
 * Fallback BroadcastReceiver for devices where CallScreeningService
 * isn't set as default. Detects incoming calls via PHONE_STATE broadcast
 * and ends the call if it matches the spam database.
 */
class IncomingCallReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "IncomingCallReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return

        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE)
        if (state != TelephonyManager.EXTRA_STATE_RINGING) return

        val number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER) ?: return
        Log.d(TAG, "Incoming call detected from: $number")

        val db = SpamDatabase(context)
        if (!db.isBlockingEnabled()) return

        val blockResult = CallBlockHelper.shouldBlockCall(db, number, context)

        if (blockResult.shouldBlock) {
            Log.i(TAG, "BLOCKING call from $number via TelephonyManager")

            db.logBlockedCall(BlockedCallRecord(
                number = number,
                callerName = blockResult.spamName,
                category = blockResult.category,
                reason = blockResult.reason
            ))

            // End call using TelecomManager (API 28+) or reflection fallback
            CallBlockHelper.endCall(context)

            CallBlockHelper.showBlockedNotification(
                context, number, blockResult.spamName, blockResult.category
            )
        }
    }
}
