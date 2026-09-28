// BOSS海投助手 · 启停控制
// 从原单体 content.js 抽出（重构第 3 步）。逻辑未做任何改动。
//
// 加载顺序：30 位于 20-core 之后，因此可以在此处直接绑定 Core。
(function () {
    'use strict';

    const CONFIG = __BH__.CONFIG;
    const state = __BH__.state;
    const elements = __BH__.elements;
    const Core = __BH__.Core;
    const FilterUtils = __BH__.FilterUtils;

    // 「应该处于运行中」的持久化标志。
    //
    // 为什么需要它：BOSS 会反爬跳转、页面可能被浏览器挂起后重载、
    // 电脑可能休眠。此时 content script 被销毁重建，state.isRunning
    // 回到 false —— 求职者要"启动就走开"，回来时应该还在跑。
    // 所以把"意图"落盘：页面重建后据此自动续跑。
    const RUN_FLAG = 'bossShouldRun';

    function setRunFlag(on) {
        try {
            if (on) localStorage.setItem(RUN_FLAG, '1');
            else localStorage.removeItem(RUN_FLAG);
        } catch (_) { /* 隐私模式等存储不可用时忽略 */ }
    }

    function shouldRun() {
        try { return localStorage.getItem(RUN_FLAG) === '1'; } catch (_) { return false; }
    }

    function toggleProcess() {
        state.isRunning = !state.isRunning;
        if (state.isRunning) {
            // 保存筛选设置
            state.filterKeyword = elements.filterInput.value.trim();
            state.locationKeyword = elements.locationInput.value.trim();
            FilterUtils.saveFilters();

            // 本次运行的统计起点（状态条据它估算剩余时间）
            state.runStats.startedAt = Date.now();
            state.runStats.applied = 0;
            state.runStats.pending = 0;
            state.runStats.skipped = 0;
            state.runStats.failed = 0;
            state.lastProgressAt = Date.now();
            try { localStorage.setItem('bossRunStats', JSON.stringify(state.runStats)); } catch (_) {}

            // 启动前先看今日额度 —— 到顶就别让用户白等
            const cap = (CONFIG.MATCH && CONFIG.MATCH.DAILY_CAP) || 80;
            const today = new Date().toISOString().slice(0, 10);
            if (state.runStats.todayDate !== today) {
                state.runStats.todayDate = today;
                state.runStats.todayApplied = 0;
            }
            if (state.runStats.todayApplied >= cap) {
                Core.log(`🛑 今日已投 ${state.runStats.todayApplied}/${cap} 家，达到上限，明天再来`);
                state.isRunning = false;
                return;
            }

            elements.controlBtn.textContent = '停止海投';
            elements.controlBtn.style.background = `linear-gradient(45deg, ${CONFIG.COLORS.SECONDARY}, #f44336)`;
            const startTime = new Date();
            Core.log(`🚀 开始自动海投，时间：${startTime.toLocaleTimeString()}`);
            Core.log(`   今日额度 ${state.runStats.todayApplied}/${cap}，欢迎语将针对每条 JD 单独生成`);

            // 落盘"应该运行中"的意图 —— 页面被重载/浏览器挂起后据此自动续跑
            setRunFlag(true);
            Core.startProcessing();
            startWatchdog();
        } else {
            elements.controlBtn.textContent = '启动海投';
            elements.controlBtn.style.background = `linear-gradient(45deg, ${CONFIG.COLORS.PRIMARY}, #4db6ac)`;
            state.isRunning = false;
            // 用户主动停止 → 清掉意图标志，并停掉看门狗
            setRunFlag(false);
            stopWatchdog();
            // 取消可能仍在进行的滚动递归，避免"停止"后残留循环继续跑
            if (typeof Core.stopAutoScroll === 'function') Core.stopAutoScroll();
            const stopTime = new Date();
            Core.log(`⏹ 停止自动海投，时间：${stopTime.toLocaleTimeString()}`);
            Core.log(`📊 本次共沟通 ${state.currentIndex} 个岗位`);
            state.currentIndex = 0;
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  看门狗：主循环意外死掉时把它拉起来
    //
    //  为什么需要：主循环是 while 里 await，任何一处未捕获的异常
    //  （或浏览器把页面挂起后重载）都会让它静默退出，而用户已经走开了。
    //  看门狗每 30 秒检查一次：如果"意图是运行中"但循环已经不在跑，
    //  就重新启动它。
    // ══════════════════════════════════════════════════════════════
    let watchdogTimer = null;

    function startWatchdog() {
        stopWatchdog();
        watchdogTimer = setInterval(() => {
            // 用户已停 → 不干预
            if (!shouldRun()) { stopWatchdog(); return; }
            // 额度到顶 → 不重启（见 startProcessing 里的检查）
            const cap = (CONFIG.MATCH && CONFIG.MATCH.DAILY_CAP) || 80;
            const today = new Date().toISOString().slice(0, 10);
            const used = state.runStats.todayDate === today ? (state.runStats.todayApplied || 0) : 0;
            if (used >= cap) return;

            if (!state.isRunning) {
                try {
                    Core.log('🔄 检测到主循环已停止但任务仍在运行中，自动重启');
                    state.isRunning = true;
                    Core.startProcessing();
                } catch (e) {
                    try { Core.log(`⚠️ 自动重启失败：${e.message}`); } catch (_) { }
                }
            }
        }, 30 * 1000);
    }

    function stopWatchdog() {
        if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
    }

    function toggleChatProcess() {
        state.isRunning = !state.isRunning;
        if (state.isRunning) {
            elements.controlBtn.textContent = '停止智能聊天';
            elements.controlBtn.style.background = `linear-gradient(45deg, ${CONFIG.COLORS.SECONDARY}, #f44336)`;
            Core.log('开始智能聊天');
            Core.startProcessing();
        } else {
            elements.controlBtn.textContent = '开始智能聊天';
            elements.controlBtn.style.background = `linear-gradient(45deg, ${CONFIG.COLORS.PRIMARY}, #4db6ac)`;
            state.isRunning = false;
            Core.log('停止智能聊天');
        }
    }

    /**
     * 自动续跑：页面被重载 / 浏览器挂起后重建时调用。
     *
     * 触发场景（求职者要"启动就走开"，这些都可能发生）：
     *   · BOSS 反爬跳转带 ?_security_check= 导致页面重载
     *   · 电脑休眠唤醒后浏览器重载标签页
     *   · 浏览器内存回收（Efficiency Mode）后恢复页面
     *
     * 安全性：投过的岗位有指纹记录，不会重投；额度上限也仍然生效，
     * 所以即使反复续跑也不会失控。
     *
     * @returns {boolean} 是否真的续跑了
     */
    function resumeIfNeeded() {
        if (!shouldRun()) return false;
        if (state.isRunning) return false;

        // 额度到顶就不续跑 —— 否则每次页面重载都白跑一遍
        const cap = (CONFIG.MATCH && CONFIG.MATCH.DAILY_CAP) || 80;
        const today = new Date().toISOString().slice(0, 10);
        if (state.runStats.todayDate !== today) {
            state.runStats.todayDate = today;
            state.runStats.todayApplied = 0;
        }
        if (state.runStats.todayApplied >= cap) {
            Core.log(`🛑 今日已投 ${state.runStats.todayApplied}/${cap} 家，不再自动续跑`);
            setRunFlag(false);
            return false;
        }

        Core.log('🔄 检测到上次的海投任务未完成，自动续跑（已投过的不会重投）');
        state.isRunning = true;
        state.runStats.startedAt = state.runStats.startedAt || Date.now();
        state.lastProgressAt = Date.now();
        if (elements.controlBtn) {
            elements.controlBtn.textContent = '停止海投';
            elements.controlBtn.style.background = `linear-gradient(45deg, ${CONFIG.COLORS.SECONDARY}, #f44336)`;
        }
        try { Core.startProcessing(); } catch (e) {
            Core.log(`⚠️ 续跑失败：${e.message}`);
            state.isRunning = false;
            return false;
        }
        startWatchdog();
        return true;
    }

    __BH__.toggleProcess = toggleProcess;
    __BH__.toggleChatProcess = toggleChatProcess;
    // 供 99-content.js 在初始化时调用
    __BH__.resumeIfNeeded = resumeIfNeeded;
    __BH__.hasRunIntent = shouldRun;
})();
