// BOSS海投助手 · 状态与 DOM 引用
// 从原单体 content.js 抽出（重构第 2 步）。逻辑未做任何改动。
//
// 注意：本模块导出的是"对象引用"。所有模块对其内部字段的修改
// （state.filters.xxx = ...）都是共享可见的；但不要整体替换
// __BH__.state = {...}，否则已绑定的模块仍指向旧对象。
(function () {
    'use strict';

    const state = {
        isRunning: false,
        currentIndex: 0,
        // 基础筛选
        filterKeyword: '',
        locationKeyword: '',
        // 高级筛选
        filters: {
            salaryMin: '',
            salaryMax: '',
            experience: '',
            education: '',
            companySize: '',
            industryKeyword: '',
            companyKeyword: '',
            excludeKeywords: '',
            excludeCompanies: '',
            // 默认启用的 JD 排除词。
            // 2026-09-29 按求职者最新要求调整：
            //   移除「大小周」「单休」——求职者明确表示大小周可接受
            //   移除「地推」        ——求职者自己做过地推，排除它等于排除同类公司
            //   保留「电销」「电话销售」——求职者能接受打电话开发客户，
            //     但这两词在 JD 里通常只出现在纯电销岗，仍要排除
            //   新增四类           ——与目标岗位方向无关的销售类型
            excludeContentKeywords: [
                '电销', '电话销售', '狼性文化', '996', '末位淘汰',
                '外包', '劳务派遣', '无底薪', '不交社保',
                '保险代理', '房产中介', '催收'
            ]
        },
        jobList: [],
        isMinimized: false,
        showAdvancedFilters: false,
        // 注意：这里**不能**在对象字面量里直接 JSON.parse(localStorage...)。
        // 一旦 localStorage 中任一键的数据损坏（非合法 JSON），JSON.parse 会抛错，
        // 整个 02-state.js 模块加载失败，后续依赖 state 的模块全部挂掉，
        // 表现为"面板完全不出现"。
        // 因此先用安全默认值，再在下方用 try/catch 逐项加载（见 loadPersistedState）。
        processedHRs: new Set(),
        appliedJobs: new Set(),
        currentTopHRKey: null,
        aiReplyCount: 0,
        lastAiDate: '',
        // 简历信息
        resume: {
            name: '',
            yearsOfExp: '',
            skills: '',
            highlight: '',
            education: '',
            currentCompany: '',
            targetPosition: ''
        },
        // 当前岗位JD
        currentJD: {
            title: '',
            salary: '',
            company: '',
            description: '',
            requirements: ''
        },

        // ══════════════════════════════════════════════════════════════
        //  JD 匹配相关状态（2026-09-29 新增）
        // ══════════════════════════════════════════════════════════════
        // 匹配结果缓存：jobId → { lo, hi, tierLabel, reason, mustHave, gap, risk, ... }
        // 目的：同一条 JD 不重复分析（省 token、也保证结果稳定）
        matchCache: {},
        // 待确认列表：分数不到自动投递线、但也没到淘汰线的岗位
        // 全部保留、按分数从高到低展示，等用户回来勾选
        pendingJobs: [],
        // 已投递的详细档案（比 appliedJobs 的指纹多很多信息）
        appliedLog: [],
        // 本次运行的统计
        runStats: {
            startedAt: null,
            applied: 0,
            pending: 0,
            skipped: 0,
            failed: 0,
            // 当日计数（用于 80 家封顶）
            todayApplied: 0,
            todayDate: ''
        },
        // 卡住的判定：最后一次有进展的时间戳
        lastProgressAt: null,
        // 已跳过的不再重试（如"继续沟通"的岗位、招呼语发送失败的）
        skipList: {}
    };

    // 从localStorage加载所有设置
    //
    // 每一项都独立 try/catch —— 不能整块包一个 try。
    // 原因：若 bossFilters 数据损坏，整块 catch 会让后面的简历、
    // 筛选关键词统统不被加载，用户会以为"设置全丢了"。
    // 逐项隔断可以做到"坏哪项只丢哪项"。

    // 已投递记录 / 已处理 HR / AI 用量
    try {
        const hrData = localStorage.getItem('processedHRs');
        if (hrData) state.processedHRs = new Set(JSON.parse(hrData));
    } catch (e) { console.warn('[BOSS海投助手] 加载 processedHRs 失败，已重置:', e.message); }
    try {
        const jobData = localStorage.getItem('appliedJobs');
        if (jobData) state.appliedJobs = new Set(JSON.parse(jobData));
    } catch (e) { console.warn('[BOSS海投助手] 加载 appliedJobs 失败，已重置:', e.message); }
    try {
        const replyCount = localStorage.getItem('aiReplyCount');
        if (replyCount) state.aiReplyCount = parseInt(replyCount, 10) || 0;
    } catch (e) { console.warn('[BOSS海投助手] 加载 aiReplyCount 失败，已重置:', e.message); }
    try {
        state.lastAiDate = localStorage.getItem('lastAiDate') || '';
    } catch (e) { /* 读取失败时保持默认空值 */ }

    // 筛选条件
    try {
        const savedFilters = localStorage.getItem('bossFilters');
        if (savedFilters) {
            Object.assign(state.filters, JSON.parse(savedFilters));
            // 兼容旧版字符串格式
            if (typeof state.filters.excludeContentKeywords === 'string') {
                state.filters.excludeContentKeywords = state.filters.excludeContentKeywords
                    .split(',').map(k => k.trim()).filter(k => k);
            }
        }
    } catch (e) { console.warn('[BOSS海投助手] 加载筛选设置失败，已用默认值:', e.message); }

    try {
        state.filterKeyword = localStorage.getItem('bossFilterKeyword') || '';
        state.locationKeyword = localStorage.getItem('bossLocationKeyword') || '';
    } catch (e) { /* 保持默认空值 */ }

    // 简历（含全文）
    try {
        const savedResume = localStorage.getItem('bossResume');
        if (savedResume) {
            Object.assign(state.resume, JSON.parse(savedResume));
        }
    } catch (e) { console.warn('[BOSS海投助手] 加载简历失败，已用默认值:', e.message); }

    try {
        const raw = localStorage.getItem('bossResumeRawText');
        if (raw) state.resume.rawText = raw;
    } catch (e) { /* 保持无全文 */ }

    // ── JD 匹配相关（2026-09-29 新增）──
    // 同样逐项 try/catch：任一项损坏不影响其余功能。
    try {
        const mc = localStorage.getItem('bossMatchCache');
        if (mc) state.matchCache = JSON.parse(mc);
    } catch (e) { console.warn('[BOSS海投助手] 加载匹配缓存失败，已重置:', e.message); }

    try {
        const pj = localStorage.getItem('bossPendingJobs');
        if (pj) state.pendingJobs = JSON.parse(pj);
    } catch (e) { console.warn('[BOSS海投助手] 加载待确认列表失败，已重置:', e.message); }

    try {
        const al = localStorage.getItem('bossAppliedLog');
        if (al) state.appliedLog = JSON.parse(al);
    } catch (e) { console.warn('[BOSS海投助手] 加载投递档案失败，已重置:', e.message); }

    try {
        const rs = localStorage.getItem('bossRunStats');
        if (rs) Object.assign(state.runStats, JSON.parse(rs));
    } catch (e) { console.warn('[BOSS海投助手] 加载运行统计失败，已用默认值:', e.message); }

    try {
        const sl = localStorage.getItem('bossSkipList');
        if (sl) state.skipList = JSON.parse(sl);
    } catch (e) { console.warn('[BOSS海投助手] 加载跳过列表失败，已重置:', e.message); }

    // 跨日重置当日计数（否则昨天的用量会一直占着今天的额度）
    try {
        const today = new Date().toISOString().slice(0, 10);
        if (state.runStats.todayDate !== today) {
            state.runStats.todayDate = today;
            state.runStats.todayApplied = 0;
        }
    } catch (e) { /* 忽略 */ }

    const elements = {
        panel: null,
        controlBtn: null,
        log: null,
        filterInput: null,
        locationInput: null,
        miniIcon: null,
        advancedFilterPanel: null,
        toggleAdvancedBtn: null,
        filterSelects: {},
        appliedCountEl: null
    };

    __BH__.state = state;
    __BH__.elements = elements;
})();
