package com.spamblocker.app.ui

import android.Manifest
import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.app.AlertDialog
import android.app.role.RoleManager
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.animation.AnimationUtils
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.spamblocker.app.R
import com.spamblocker.app.data.BlockedCallRecord
import com.spamblocker.app.data.SpamDatabase
import com.spamblocker.app.data.SpamNumber
import java.text.SimpleDateFormat
import java.util.*

class MainActivity : AppCompatActivity() {

    private lateinit var db: SpamDatabase
    private val PERMISSIONS_REQUEST_CODE = 100
    private val ROLE_REQUEST_CODE = 200

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        db = SpamDatabase(this)

        requestPermissions()
        requestCallScreeningRole()
        setupTabs()
        refreshDashboard()
        refreshBlocklist()
        refreshLog()
        setupSettings()
    }

    // ── Permissions ──

    private val requiredPermissions = arrayOf(
        Manifest.permission.READ_PHONE_STATE,
        Manifest.permission.READ_CALL_LOG,
        Manifest.permission.READ_CONTACTS,
        Manifest.permission.ANSWER_PHONE_CALLS,
    )

    private fun requestPermissions() {
        val needed = requiredPermissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
                needed.toMutableList().add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        if (needed.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), PERMISSIONS_REQUEST_CODE)
        }
    }

    private fun requestCallScreeningRole() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val roleManager = getSystemService(RoleManager::class.java)
            if (roleManager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING) &&
                !roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) {
                val intent = roleManager.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING)
                startActivityForResult(intent, ROLE_REQUEST_CODE)
            }
        }
    }

    // ── Tab Navigation ──

    private fun setupTabs() {
        val tabDashboard = findViewById<TextView>(R.id.tab_dashboard)
        val tabBlocklist = findViewById<TextView>(R.id.tab_blocklist)
        val tabLog = findViewById<TextView>(R.id.tab_log)
        val tabSettings = findViewById<TextView>(R.id.tab_settings)

        val sectionDashboard = findViewById<View>(R.id.section_dashboard)
        val sectionBlocklist = findViewById<View>(R.id.section_blocklist)
        val sectionLog = findViewById<View>(R.id.section_log)
        val sectionSettings = findViewById<View>(R.id.section_settings)

        val tabs = listOf(tabDashboard, tabBlocklist, tabLog, tabSettings)
        val sections = listOf(sectionDashboard, sectionBlocklist, sectionLog, sectionSettings)

        var currentTabIndex = 0

        fun selectTab(index: Int) {
            if (index == currentTabIndex && sections[index].visibility == View.VISIBLE) return

            tabs.forEachIndexed { i, tab ->
                tab.isSelected = (i == index)
                tab.setBackgroundResource(
                    if (i == index) R.drawable.tab_selected else R.drawable.tab_unselected
                )
                // Animate the selected tab with a pop effect
                if (i == index) {
                    tab.scaleX = 0.9f
                    tab.scaleY = 0.9f
                    tab.animate()
                        .scaleX(1f).scaleY(1f)
                        .setDuration(300)
                        .setInterpolator(OvershootInterpolator(2f))
                        .start()
                }
            }

            // Animate section transition
            val outgoing = sections[currentTabIndex]
            val incoming = sections[index]

            if (outgoing != incoming) {
                // Slide out the current section
                outgoing.animate()
                    .alpha(0f)
                    .translationX(if (index > currentTabIndex) -80f else 80f)
                    .setDuration(200)
                    .setInterpolator(DecelerateInterpolator())
                    .withEndAction {
                        outgoing.visibility = View.GONE
                        outgoing.translationX = 0f
                        outgoing.alpha = 1f

                        // Slide in the new section
                        incoming.visibility = View.VISIBLE
                        incoming.alpha = 0f
                        incoming.translationX = if (index > currentTabIndex) 80f else -80f
                        incoming.animate()
                            .alpha(1f)
                            .translationX(0f)
                            .setDuration(350)
                            .setInterpolator(DecelerateInterpolator(2f))
                            .start()
                    }
                    .start()
            }

            currentTabIndex = index
        }

        tabDashboard.setOnClickListener { selectTab(0); refreshDashboard() }
        tabBlocklist.setOnClickListener { selectTab(1); refreshBlocklist() }
        tabLog.setOnClickListener { selectTab(2); refreshLog() }
        tabSettings.setOnClickListener { selectTab(3) }

        selectTab(0)
    }

    // ── Dashboard ──

    private fun refreshDashboard() {
        findViewById<TextView>(R.id.stat_today).text = db.getTodayBlockedCount().toString()
        findViewById<TextView>(R.id.stat_total).text = db.getTotalBlockedCount().toString()
        findViewById<TextView>(R.id.stat_blocklist).text = db.getBlocklistCount().toString()

        val status = findViewById<TextView>(R.id.status_text)
        val statusDot = findViewById<View>(R.id.status_dot)
        if (db.isBlockingEnabled()) {
            status.text = "Protection Active"
            statusDot.setBackgroundResource(R.drawable.dot_green)
        } else {
            status.text = "Protection Disabled"
            statusDot.setBackgroundResource(R.drawable.dot_red)
        }

        // Recent blocked calls
        val recentList = findViewById<RecyclerView>(R.id.recent_blocked_list)
        recentList.layoutManager = LinearLayoutManager(this)
        recentList.adapter = BlockedLogAdapter(db.getBlockedLog(5))
    }

    // ── Blocklist ──

    private fun refreshBlocklist() {
        val list = findViewById<RecyclerView>(R.id.blocklist_recycler)
        list.layoutManager = LinearLayoutManager(this)
        list.adapter = BlocklistAdapter(db.getBlocklist()) { spam ->
            AlertDialog.Builder(this)
                .setTitle("Remove from blocklist?")
                .setMessage("${spam.name}\n${spam.number}")
                .setPositiveButton("Remove") { _, _ ->
                    db.removeFromBlocklist(spam.id)
                    refreshBlocklist()
                }
                .setNegativeButton("Cancel", null)
                .show()
        }

        findViewById<Button>(R.id.btn_add_number).setOnClickListener { showAddNumberDialog() }
    }

    private fun showAddNumberDialog() {
        val dialogView = LayoutInflater.from(this).inflate(R.layout.dialog_add_number, null)
        val etNumber = dialogView.findViewById<EditText>(R.id.et_number)
        val etName = dialogView.findViewById<EditText>(R.id.et_name)
        val spinnerCategory = dialogView.findViewById<Spinner>(R.id.spinner_category)

        val categories = arrayOf("telecom", "credit", "realestate", "custom")
        val labels = arrayOf("Telecom Spam", "Credit Card / Loan", "Real Estate", "Other")
        spinnerCategory.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, labels)

        AlertDialog.Builder(this)
            .setTitle("Add Number to Blocklist")
            .setView(dialogView)
            .setPositiveButton("Block") { _, _ ->
                val number = etNumber.text.toString().trim()
                val name = etName.text.toString().trim().ifEmpty { "Manual block" }
                val category = categories[spinnerCategory.selectedItemPosition]
                if (number.isNotEmpty()) {
                    db.addToBlocklist(SpamNumber(
                        number = number,
                        name = name,
                        category = category,
                        isPattern = number.contains("*")
                    ))
                    refreshBlocklist()
                    Toast.makeText(this, "Blocked: $number", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    // ── Call Log ──

    private fun refreshLog() {
        val list = findViewById<RecyclerView>(R.id.log_recycler)
        list.layoutManager = LinearLayoutManager(this)
        list.adapter = BlockedLogAdapter(db.getBlockedLog(100))

        findViewById<Button>(R.id.btn_clear_log).setOnClickListener {
            AlertDialog.Builder(this)
                .setTitle("Clear blocked call log?")
                .setPositiveButton("Clear") { _, _ ->
                    db.clearLog()
                    refreshLog()
                }
                .setNegativeButton("Cancel", null)
                .show()
        }
    }

    // ── Settings ──

    private fun setupSettings() {
        setupToggle(R.id.toggle_blocking, "blocking_enabled")
        setupToggle(R.id.toggle_telecom, "block_telecom")
        setupToggle(R.id.toggle_credit, "block_credit")
        setupToggle(R.id.toggle_realestate, "block_realestate")
        setupToggle(R.id.toggle_international, "block_international")
        setupToggle(R.id.toggle_prefix140, "block_prefix_140")
        setupToggle(R.id.toggle_whitelist, "whitelist_only")
    }

    private fun setupToggle(viewId: Int, settingKey: String) {
        val toggle = findViewById<Switch>(viewId)
        toggle.isChecked = db.getSetting(settingKey, "true") == "true"
        toggle.setOnCheckedChangeListener { _, isChecked ->
            db.setSetting(settingKey, if (isChecked) "true" else "false")
            refreshDashboard()
        }
    }

    // ── Adapters ──

    inner class BlocklistAdapter(
        private val items: List<SpamNumber>,
        private val onRemove: (SpamNumber) -> Unit
    ) : RecyclerView.Adapter<BlocklistAdapter.VH>() {

        inner class VH(view: View) : RecyclerView.ViewHolder(view) {
            val tvNumber: TextView = view.findViewById(R.id.tv_number)
            val tvName: TextView = view.findViewById(R.id.tv_name)
            val tvCategory: TextView = view.findViewById(R.id.tv_category)
            val tvReports: TextView = view.findViewById(R.id.tv_reports)
            val btnRemove: ImageButton = view.findViewById(R.id.btn_remove)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
            val view = LayoutInflater.from(parent.context)
                .inflate(R.layout.item_blocklist, parent, false)
            return VH(view)
        }

        override fun onBindViewHolder(holder: VH, position: Int) {
            val item = items[position]
            holder.tvNumber.text = item.number
            holder.tvName.text = item.name
            holder.tvCategory.text = when (item.category) {
                "telecom" -> "TELECOM"
                "credit" -> "CREDIT CARD"
                "realestate" -> "REAL ESTATE"
                else -> "CUSTOM"
            }
            holder.tvReports.text = "${item.reports} reports"
            holder.btnRemove.setOnClickListener { onRemove(item) }
        }

        override fun getItemCount() = items.size
    }

    inner class BlockedLogAdapter(
        private val items: List<BlockedCallRecord>
    ) : RecyclerView.Adapter<BlockedLogAdapter.VH>() {

        private val dateFormat = SimpleDateFormat("MMM dd, HH:mm", Locale.getDefault())

        inner class VH(view: View) : RecyclerView.ViewHolder(view) {
            val tvNumber: TextView = view.findViewById(R.id.log_number)
            val tvName: TextView = view.findViewById(R.id.log_name)
            val tvCategory: TextView = view.findViewById(R.id.log_category)
            val tvTime: TextView = view.findViewById(R.id.log_time)
            val tvReason: TextView = view.findViewById(R.id.log_reason)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
            val view = LayoutInflater.from(parent.context)
                .inflate(R.layout.item_blocked_log, parent, false)
            return VH(view)
        }

        override fun onBindViewHolder(holder: VH, position: Int) {
            val item = items[position]
            holder.tvNumber.text = item.number
            holder.tvName.text = item.callerName
            holder.tvCategory.text = when (item.category) {
                "telecom" -> "TELECOM"
                "credit" -> "CREDIT CARD"
                "realestate" -> "REAL ESTATE"
                else -> "SPAM"
            }
            holder.tvTime.text = dateFormat.format(Date(item.blockedAt))
            holder.tvReason.text = item.reason
        }

        override fun getItemCount() = items.size
    }
}
