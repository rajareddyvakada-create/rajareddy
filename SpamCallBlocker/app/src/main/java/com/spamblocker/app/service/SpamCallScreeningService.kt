package com.spamblocker.app.service

import android.os.Build
import android.telecom.Call
import android.telecom.CallScreeningService
import android.util.Log
import com.spamblocker.app.data.BlockedCallRecord
import com.spamblocker.app.data.SpamDatabase
import com.spamblocker.app.util.CallBlockHelper

/**
 * Android's official CallScreeningService (API 24+).
 * When set as the default call screening app, this intercepts ALL incoming
 * calls BEFORE they ring and can silently reject spam.
 */
class SpamCallScreeningService : CallScreeningService() {

    companion object {
        private const val TAG = "SpamScreening"
    }

    override fun onScreenCall(callDetails: Call.Details) {
        val number = callDetails.handle?.schemeSpecificPart ?: ""
        Log.d(TAG, "Screening incoming call from: $number")

        val db = SpamDatabase(applicationContext)

        if (!db.isBlockingEnabled()) {
            respondAllow(callDetails)
            return
        }

        val blockResult = CallBlockHelper.shouldBlockCall(db, number, applicationContext)

        if (blockResult.shouldBlock) {
            Log.i(TAG, "BLOCKING call from $number — reason: ${blockResult.reason}")

            db.logBlockedCall(BlockedCallRecord(
                number = number,
                callerName = blockResult.spamName,
                category = blockResult.category,
                reason = blockResult.reason
            ))

            val response = CallResponse.Builder()
                .setDisallowCall(true)
                .setRejectCall(true)
                .setSkipCallLog(false)    // still show in call log
                .setSkipNotification(true) // no ring or notification
                .build()

            respondToCall(callDetails, response)

            CallBlockHelper.showBlockedNotification(
                applicationContext, number, blockResult.spamName, blockResult.category
            )
        } else {
            respondAllow(callDetails)
        }
    }

    private fun respondAllow(callDetails: Call.Details) {
        val response = CallResponse.Builder()
            .setDisallowCall(false)
            .setRejectCall(false)
            .setSkipCallLog(false)
            .setSkipNotification(false)
            .build()
        respondToCall(callDetails, response)
    }
}
