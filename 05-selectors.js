// BOSS海投助手 · BOSS 页面选择器单一来源
//
// ─────────────────────────────────────────────────────────────────
// 为什么需要这个文件
// ─────────────────────────────────────────────────────────────────
// 2026-09 发现：代码中硬编码的选择器与真实 BOSS 页面**不一致**，导致
// 薪资筛选、经验/学历筛选、排除公司、以及反重复投递的 key 全部静默失效。
// 根因之一是选择器散落在各模块、没有单一来源，漂移了也无人察觉。
//
// 因此把所有**指向 BOSS 页面**的选择器集中到这里，每个附验证状态。
// 换选择器只需改一处；新增选择器时"未知"状态会持续提醒需要实测。
//
// ─────────────────────────────────────────────────────────────────
// 验证状态的含义（务必如实维护）
// ─────────────────────────────────────────────────────────────────
//   verified  —— 用 tools/selector-audit.js 对真实页面实测确认过
//   unverified—— 尚未实测。可能是对的，也可能已过时，不要默认可信
//
// 修改任何标注 verified 的选择器后，必须重跑：
//     node tools/selector-audit.js
// 并在登录状态下复核标为 unverified 的部分。
// ─────────────────────────────────────────────────────────────────
(function () {
    'use strict';

    // ===== 职位列表页（/web/geek/jobs）=====
    // verified：2026-09 对公开列表页采样 8 张卡片实测
    const JOB_CARD = 'li.job-card-box';                       // verified
    const JOB_CARD_SCOPE = 'li.job-card-box';                 // verified（同上，语义化别名）

    // 单个岗位卡片内的字段。数组顺序即回落优先级。
    const JOB_CARD_FIELDS = {
        // verified：真实类名为 .job-salary；旧代码误用 .salary
        salary: ['.job-salary', '.salary'],
        // verified：真实类名为 .boss-name；旧代码误用 .company-name
        company: ['.boss-name', '.company-name', '.company-info .company-name'],
        // verified：经验/学历/技能都在 .tag-list li 中
        tags: ['.tag-list li', '.tag-item', '.job-tags span', '.tags span'],
        // verified
        location: ['.company-location', '.job-area'],
        // verified（标题两处一致）
        title: ['.job-name', '.job-title .job-name'],
        // verified：列表页不存在该元素（实测 8/8 为空），保留以备结构变化
        companyInfo: ['.company-info'],
        // verified：岗位详情链接，形如 /job_detail/<岗位ID>.html
        // 其中的岗位 ID 是去重最可靠的指纹 —— 标题+公司名会因公司名抓取
        // 失败而退化，导致不同公司的同名岗位被误判为重复（已实际发生）。
        jobLink: ['.job-title a.job-name', 'a.job-name', '.job-card-box a[href*="/job_detail/"]'],
    };

    // 列表页的"立即沟通"按钮。verified：公开列表页未出现，仅在选中岗位后
    // 的详情区出现，因此按详情页处理，标为 unverified。
    const CHAT_ENTRY_BUTTON = 'a.op-btn-chat';                // unverified

    // 打招呼达上限时的弹窗按钮（"留在此页"）
    const GREETING_MODAL_CANCEL = '.default-btn.cancel-btn';  // unverified

    // ===== 职位详情（选中岗位后的 JD 区）=====
    // unverified：job_detail 页面结构未实测（与列表页类名不同）
    const JOB_DETAIL = {
        title: ['.job-name', '.job-title .job-name', '.name'],
        salary: ['.job-salary', '.salary', '.job-detail .salary'],
        company: [
            '.boss-name', '.company-info .company-name', '.company-name',
            '.company-info h3', '.sider-company .name',
        ],
        description: [
            '.job-sec-text',
            '.job-detail .text',
            '.job-description',
            '.position-content',
            '[class*="job-detail"] [class*="text"]',
            '.job-info .job-sec:nth-child(1) .job-sec-text',
        ],
        requirements: [
            '.job-sec:nth-child(2) .job-sec-text',
            '[class*="requirement"]',
            '.job-requirements',
        ],
    };

    // 详情区提取不到描述时的兜底关键词（用于从全文截取）
    const JD_TEXT_MARKERS = ['职位描述', '岗位职责', '任职要求'];  // unverified

    // ===== 聊天页（/web/geek/chat）=====
    // 整组 unverified：聊天页需登录，尚未实测。
    // 这是目前**最大的未验证面**，登录后应优先核对。
    const CHAT = {
        chatList: 'ul',                                            // unverified
        latestChatItem: 'li[role="listitem"][class]:has(.friend-content-warp)', // unverified
        friendName: '.name-text',                                  // unverified
        friendCompany: '.name-box span:nth-child(2)',              // unverified
        avatar: '.figure',                                         // unverified
        sendButton: '.btn-send',                                   // unverified
        commonPhraseButton: '.btn-dict',                           // unverified
        commonPhraseList: 'ul[data-v-8e790d94=""]',                // unverified
        messageListA: '.chat-message .im-list',                    // unverified
        messageListB: 'li.message-item',                           // unverified
        friendMessageText: '.text span',                           // unverified
        toolbarButton: '.toolbar-btn',                             // unverified
        resumeSendConfirm: 'span.btn-sure-v2',                     // unverified
        resumeSendButtonText: '发简历',                            // unverified
    };

    // ===== 扩展自身注入的 DOM（这些是我们自己创建的，不存在漂移风险）=====
    // 单独分组，以免与"指向 BOSS 页面的选择器"混淆。
    const OWN_UI = {
        panel: '#boss-pro-panel',
        settingsDialog: '#boss-settings-dialog',
        log: '#pro-log',
    };

    __BH__.SELECTORS = {
        JOB_CARD,
        JOB_CARD_SCOPE,
        JOB_CARD_FIELDS,
        CHAT_ENTRY_BUTTON,
        GREETING_MODAL_CANCEL,
        JOB_DETAIL,
        JD_TEXT_MARKERS,
        CHAT,
        OWN_UI,
    };

    // 供 tools/selector-audit.js 读取的验证状态清单。
    // 目的是让"还有多少未验证"变成一个可查询的数字，而不是靠记忆。
    __BH__.SELECTOR_META = {
        verified: [
            JOB_CARD,
            ...JOB_CARD_FIELDS.title,
            ...JOB_CARD_FIELDS.salary,
            ...JOB_CARD_FIELDS.company,
            ...JOB_CARD_FIELDS.tags,
            ...JOB_CARD_FIELDS.location,
        ],
        unverified: [
            CHAT_ENTRY_BUTTON, GREETING_MODAL_CANCEL,
            ...JOB_DETAIL.title, ...JOB_DETAIL.salary, ...JOB_DETAIL.company,
            ...JOB_DETAIL.description, ...JOB_DETAIL.requirements,
            ...JD_TEXT_MARKERS,
            ...Object.values(CHAT),
        ],
        // 自研注入的选择器，无需对外部页面验证
        own: Object.values(OWN_UI),
    };
})();
