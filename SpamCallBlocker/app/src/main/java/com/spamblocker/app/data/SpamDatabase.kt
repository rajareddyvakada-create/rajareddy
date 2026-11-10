package com.spamblocker.app.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

data class SpamNumber(
    val id: Long = 0,
    val number: String,
    val name: String,
    val category: String,   // "telecom", "credit", "realestate", "custom"
    val tactic: String = "",
    val reports: Int = 1,
    val isPattern: Boolean = false,  // true for prefix patterns like "140*"
    val addedAt: Long = System.currentTimeMillis()
)

data class BlockedCallRecord(
    val id: Long = 0,
    val number: String,
    val callerName: String,
    val category: String,
    val blockedAt: Long = System.currentTimeMillis(),
    val reason: String = ""
)

class SpamDatabase(context: Context) : SQLiteOpenHelper(context, DB_NAME, null, DB_VERSION) {

    companion object {
        private const val DB_NAME = "spam_blocker.db"
        private const val DB_VERSION = 1

        private const val TABLE_BLOCKLIST = "blocklist"
        private const val TABLE_LOG = "blocked_log"
        private const val TABLE_WHITELIST = "whitelist"
        private const val TABLE_SETTINGS = "settings"
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""
            CREATE TABLE $TABLE_BLOCKLIST (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                number TEXT NOT NULL,
                name TEXT DEFAULT '',
                category TEXT DEFAULT 'custom',
                tactic TEXT DEFAULT '',
                reports INTEGER DEFAULT 1,
                is_pattern INTEGER DEFAULT 0,
                added_at INTEGER DEFAULT 0
            )
        """)

        db.execSQL("""
            CREATE TABLE $TABLE_LOG (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                number TEXT NOT NULL,
                caller_name TEXT DEFAULT '',
                category TEXT DEFAULT '',
                blocked_at INTEGER DEFAULT 0,
                reason TEXT DEFAULT ''
            )
        """)

        db.execSQL("""
            CREATE TABLE $TABLE_WHITELIST (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                number TEXT NOT NULL UNIQUE
            )
        """)

        db.execSQL("""
            CREATE TABLE $TABLE_SETTINGS (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """)

        seedDefaultBlocklist(db)
        seedDefaultSettings(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS $TABLE_BLOCKLIST")
        db.execSQL("DROP TABLE IF EXISTS $TABLE_LOG")
        db.execSQL("DROP TABLE IF EXISTS $TABLE_WHITELIST")
        db.execSQL("DROP TABLE IF EXISTS $TABLE_SETTINGS")
        onCreate(db)
    }

    // ── Blocklist Operations ──

    fun addToBlocklist(spam: SpamNumber): Long {
        val db = writableDatabase
        val values = ContentValues().apply {
            put("number", spam.number.replace(" ", "").replace("-", ""))
            put("name", spam.name)
            put("category", spam.category)
            put("tactic", spam.tactic)
            put("reports", spam.reports)
            put("is_pattern", if (spam.isPattern) 1 else 0)
            put("added_at", spam.addedAt)
        }
        return db.insert(TABLE_BLOCKLIST, null, values)
    }

    fun removeFromBlocklist(id: Long) {
        writableDatabase.delete(TABLE_BLOCKLIST, "id = ?", arrayOf(id.toString()))
    }

    fun getBlocklist(category: String? = null, search: String? = null): List<SpamNumber> {
        val db = readableDatabase
        val conditions = mutableListOf<String>()
        val args = mutableListOf<String>()

        if (category != null && category != "all") {
            conditions.add("category = ?")
            args.add(category)
        }
        if (!search.isNullOrBlank()) {
            conditions.add("(number LIKE ? OR name LIKE ?)")
            args.add("%$search%")
            args.add("%$search%")
        }

        val where = if (conditions.isEmpty()) "" else "WHERE ${conditions.joinToString(" AND ")}"
        val cursor = db.rawQuery(
            "SELECT * FROM $TABLE_BLOCKLIST $where ORDER BY added_at DESC",
            args.toTypedArray()
        )

        val list = mutableListOf<SpamNumber>()
        while (cursor.moveToNext()) {
            list.add(SpamNumber(
                id = cursor.getLong(cursor.getColumnIndexOrThrow("id")),
                number = cursor.getString(cursor.getColumnIndexOrThrow("number")),
                name = cursor.getString(cursor.getColumnIndexOrThrow("name")),
                category = cursor.getString(cursor.getColumnIndexOrThrow("category")),
                tactic = cursor.getString(cursor.getColumnIndexOrThrow("tactic")),
                reports = cursor.getInt(cursor.getColumnIndexOrThrow("reports")),
                isPattern = cursor.getInt(cursor.getColumnIndexOrThrow("is_pattern")) == 1,
                addedAt = cursor.getLong(cursor.getColumnIndexOrThrow("added_at"))
            ))
        }
        cursor.close()
        return list
    }

    fun getBlocklistCount(): Int {
        val cursor = readableDatabase.rawQuery("SELECT COUNT(*) FROM $TABLE_BLOCKLIST", null)
        cursor.moveToFirst()
        val count = cursor.getInt(0)
        cursor.close()
        return count
    }

    // ── Spam Check Engine ──

    fun isSpamNumber(phoneNumber: String): SpamNumber? {
        val cleaned = phoneNumber.replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
        val db = readableDatabase

        // Direct match
        val directCursor = db.rawQuery(
            "SELECT * FROM $TABLE_BLOCKLIST WHERE is_pattern = 0 AND number = ?",
            arrayOf(cleaned)
        )
        if (directCursor.moveToFirst()) {
            val spam = cursorToSpamNumber(directCursor)
            directCursor.close()
            return spam
        }
        directCursor.close()

        // Also try matching without country code
        val withoutCode = cleaned.removePrefix("+91").removePrefix("91").removePrefix("0")
        if (withoutCode != cleaned) {
            val codeCursor = db.rawQuery(
                "SELECT * FROM $TABLE_BLOCKLIST WHERE is_pattern = 0 AND (number = ? OR number LIKE ?)",
                arrayOf(withoutCode, "%$withoutCode")
            )
            if (codeCursor.moveToFirst()) {
                val spam = cursorToSpamNumber(codeCursor)
                codeCursor.close()
                return spam
            }
            codeCursor.close()
        }

        // Pattern match (prefix patterns like "140*")
        val patternCursor = db.rawQuery(
            "SELECT * FROM $TABLE_BLOCKLIST WHERE is_pattern = 1",
            null
        )
        while (patternCursor.moveToNext()) {
            val pattern = patternCursor.getString(patternCursor.getColumnIndexOrThrow("number"))
            val prefix = pattern.replace("*", "").replace("x", "").replace("X", "")
            if (cleaned.startsWith(prefix) || cleaned.removePrefix("+91").startsWith(prefix)
                || cleaned.removePrefix("91").startsWith(prefix)
                || cleaned.removePrefix("0").startsWith(prefix)) {
                val spam = cursorToSpamNumber(patternCursor)
                patternCursor.close()
                return spam
            }
        }
        patternCursor.close()
        return null
    }

    private fun cursorToSpamNumber(cursor: android.database.Cursor): SpamNumber {
        return SpamNumber(
            id = cursor.getLong(cursor.getColumnIndexOrThrow("id")),
            number = cursor.getString(cursor.getColumnIndexOrThrow("number")),
            name = cursor.getString(cursor.getColumnIndexOrThrow("name")),
            category = cursor.getString(cursor.getColumnIndexOrThrow("category")),
            tactic = cursor.getString(cursor.getColumnIndexOrThrow("tactic")),
            reports = cursor.getInt(cursor.getColumnIndexOrThrow("reports")),
            isPattern = cursor.getInt(cursor.getColumnIndexOrThrow("is_pattern")) == 1,
            addedAt = cursor.getLong(cursor.getColumnIndexOrThrow("added_at"))
        )
    }

    // ── Blocked Call Log ──

    fun logBlockedCall(record: BlockedCallRecord): Long {
        val values = ContentValues().apply {
            put("number", record.number)
            put("caller_name", record.callerName)
            put("category", record.category)
            put("blocked_at", record.blockedAt)
            put("reason", record.reason)
        }
        return writableDatabase.insert(TABLE_LOG, null, values)
    }

    fun getBlockedLog(limit: Int = 100): List<BlockedCallRecord> {
        val cursor = readableDatabase.rawQuery(
            "SELECT * FROM $TABLE_LOG ORDER BY blocked_at DESC LIMIT ?",
            arrayOf(limit.toString())
        )
        val list = mutableListOf<BlockedCallRecord>()
        while (cursor.moveToNext()) {
            list.add(BlockedCallRecord(
                id = cursor.getLong(cursor.getColumnIndexOrThrow("id")),
                number = cursor.getString(cursor.getColumnIndexOrThrow("number")),
                callerName = cursor.getString(cursor.getColumnIndexOrThrow("caller_name")),
                category = cursor.getString(cursor.getColumnIndexOrThrow("category")),
                blockedAt = cursor.getLong(cursor.getColumnIndexOrThrow("blocked_at")),
                reason = cursor.getString(cursor.getColumnIndexOrThrow("reason"))
            ))
        }
        cursor.close()
        return list
    }

    fun getTodayBlockedCount(): Int {
        val startOfDay = java.util.Calendar.getInstance().apply {
            set(java.util.Calendar.HOUR_OF_DAY, 0)
            set(java.util.Calendar.MINUTE, 0)
            set(java.util.Calendar.SECOND, 0)
        }.timeInMillis
        val cursor = readableDatabase.rawQuery(
            "SELECT COUNT(*) FROM $TABLE_LOG WHERE blocked_at >= ?",
            arrayOf(startOfDay.toString())
        )
        cursor.moveToFirst()
        val count = cursor.getInt(0)
        cursor.close()
        return count
    }

    fun getTotalBlockedCount(): Int {
        val cursor = readableDatabase.rawQuery("SELECT COUNT(*) FROM $TABLE_LOG", null)
        cursor.moveToFirst()
        val count = cursor.getInt(0)
        cursor.close()
        return count
    }

    fun clearLog() {
        writableDatabase.delete(TABLE_LOG, null, null)
    }

    // ── Whitelist ──

    fun addToWhitelist(number: String) {
        val values = ContentValues().apply {
            put("number", number.replace(" ", "").replace("-", ""))
        }
        writableDatabase.insertWithOnConflict(TABLE_WHITELIST, null, values, SQLiteDatabase.CONFLICT_IGNORE)
    }

    fun isWhitelisted(number: String): Boolean {
        val cleaned = number.replace(" ", "").replace("-", "")
        val cursor = readableDatabase.rawQuery(
            "SELECT 1 FROM $TABLE_WHITELIST WHERE number = ?",
            arrayOf(cleaned)
        )
        val exists = cursor.moveToFirst()
        cursor.close()
        return exists
    }

    // ── Settings ──

    fun getSetting(key: String, default: String = ""): String {
        val cursor = readableDatabase.rawQuery(
            "SELECT value FROM $TABLE_SETTINGS WHERE key = ?", arrayOf(key)
        )
        val value = if (cursor.moveToFirst()) cursor.getString(0) else default
        cursor.close()
        return value
    }

    fun setSetting(key: String, value: String) {
        val cv = ContentValues().apply {
            put("key", key)
            put("value", value)
        }
        writableDatabase.insertWithOnConflict(TABLE_SETTINGS, null, cv, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun isBlockingEnabled(): Boolean = getSetting("blocking_enabled", "true") == "true"
    fun isBlockTelecom(): Boolean = getSetting("block_telecom", "true") == "true"
    fun isBlockCredit(): Boolean = getSetting("block_credit", "true") == "true"
    fun isBlockRealEstate(): Boolean = getSetting("block_realestate", "true") == "true"
    fun isBlockInternational(): Boolean = getSetting("block_international", "true") == "true"
    fun isBlockPrefix140(): Boolean = getSetting("block_prefix_140", "true") == "true"
    fun isWhitelistOnly(): Boolean = getSetting("whitelist_only", "false") == "true"

    // ── Seed Data ──

    private fun seedDefaultSettings(db: SQLiteDatabase) {
        val defaults = mapOf(
            "blocking_enabled" to "true",
            "block_telecom" to "true",
            "block_credit" to "true",
            "block_realestate" to "true",
            "block_international" to "true",
            "block_prefix_140" to "true",
            "whitelist_only" to "false",
            "silent_block" to "true"
        )
        defaults.forEach { (key, value) ->
            val cv = ContentValues().apply {
                put("key", key)
                put("value", value)
            }
            db.insert(TABLE_SETTINGS, null, cv)
        }
    }

    private fun seedDefaultBlocklist(db: SQLiteDatabase) {
        val defaults = listOf(
            // Telecom prefix patterns
            SpamNumber(number = "140", name = "All 140-prefix telemarketers", category = "telecom", reports = 50000, isPattern = true),
            SpamNumber(number = "1800", name = "Toll-free spam callers", category = "telecom", reports = 32000, isPattern = true),

            // Telecom spam numbers
            SpamNumber(number = "+917000000000", name = "Jio Fiber Promotions", category = "telecom", tactic = "Free upgrade to 1Gbps plan", reports = 4820),
            SpamNumber(number = "+917800078000", name = "Airtel DTH Upsell", category = "telecom", tactic = "Special Diwali offer expiring today", reports = 3215),
            SpamNumber(number = "+919500011000", name = "Vi Postpaid Team", category = "telecom", tactic = "Switch to postpaid, get iPhone free", reports = 1890),
            SpamNumber(number = "+916300063000", name = "ACT Fibernet Sales", category = "telecom", tactic = "Area exclusive discount, today only", reports = 1450),
            SpamNumber(number = "+917200099000", name = "Tata Play Offers", category = "telecom", tactic = "Recharge now for 6 months free", reports = 2100),

            // Credit card / loan spam
            SpamNumber(number = "+912260000000", name = "HDFC Bank Cards", category = "credit", tactic = "Pre-approved platinum card with 5L limit", reports = 8930),
            SpamNumber(number = "+914440000000", name = "ICICI Personal Loans", category = "credit", tactic = "Instant 10L loan at 10.5% — approved!", reports = 7650),
            SpamNumber(number = "+918040000000", name = "Axis Bank Credit Card", category = "credit", tactic = "Zero annual fee lifetime card", reports = 5420),
            SpamNumber(number = "+911140000000", name = "Bajaj Finserv EMI", category = "credit", tactic = "Convert all purchases to easy EMI", reports = 4100),
            SpamNumber(number = "+913360000000", name = "SBI Card Division", category = "credit", tactic = "Upgrade to SBI Elite card", reports = 3200),
            SpamNumber(number = "+911204000000", name = "Kotak Insurance Desk", category = "credit", tactic = "Mandatory health insurance — act now", reports = 6100),
            SpamNumber(number = "+919800044000", name = "Unknown Loan Agent", category = "credit", tactic = "50L home loan at 8.3% — lowest in market", reports = 5800),

            // Real estate spam
            SpamNumber(number = "+919900022000", name = "Godrej Properties Agent", category = "realestate", tactic = "New launch in Whitefield — 45L only", reports = 3400),
            SpamNumber(number = "+918800055000", name = "Prestige Group Broker", category = "realestate", tactic = "Last 5 units at pre-launch price", reports = 2800),
            SpamNumber(number = "+917000033000", name = "Generic Property Dealer", category = "realestate", tactic = "Want to sell your flat? We have buyers", reports = 6200),
            SpamNumber(number = "+919600011000", name = "Hiranandani Sales", category = "realestate", tactic = "Premium 3BHK — bank loan pre-approved", reports = 1950),
            SpamNumber(number = "+918100066000", name = "NoBroker Marketing", category = "realestate", tactic = "List your property — guaranteed tenant", reports = 1200),
            SpamNumber(number = "+919300077000", name = "DLF Investment Scam", category = "realestate", tactic = "Land plot near airport — 300% return", reports = 4600),
        )

        defaults.forEach { spam ->
            val cv = ContentValues().apply {
                put("number", spam.number)
                put("name", spam.name)
                put("category", spam.category)
                put("tactic", spam.tactic)
                put("reports", spam.reports)
                put("is_pattern", if (spam.isPattern) 1 else 0)
                put("added_at", System.currentTimeMillis())
            }
            db.insert(TABLE_BLOCKLIST, null, cv)
        }
    }
}
