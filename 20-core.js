// BOSS海投助手 · 核心业务逻辑
// 从原单体 content.js 抽出（重构第 5 步）。逻辑未做任何改动。
//
// 依赖：CONFIG(01) / state(02) / FilterUtils(10)。
// 注意：Core 不引用 UI —— 整个项目里 UI.* 只出现在 99-content.js 的 init() 中。
//
// ── 关于 toggleProcess 的循环依赖 ────────────────────────────────
// Core.resetCycle() 与 Core.processJobList() 需要调用 toggleProcess
// （在无匹配岗位或本轮跑完时自动停止），但 toggleProcess 位于
// 30-controls.js，加载顺序在 20-core.js 之后，因此不能在模块顶层绑定。
// 这里采用「调用时取用」：只在实际调用那一刻读 __BH__.toggleProcess。
// 由于两个调用点都发生在运行期（init 之后），届时模块已全部就绪。
// 若将来把 30-controls.js 移到 20 之前，可改回顶层直接绑定。
// ────────────────────────────────────────────────────────────────
(function () {
    'use strict';

    const CONFIG = __BH__.CONFIG;
    const state = __BH__.state;
    const elements = __BH__.elements;
    const FilterUtils = __BH__.FilterUtils;
    // 选择器统一来自 05-selectors.js 的单一来源
    const SEL = __BH__.SELECTORS;

    const Core = {
        basicInterval: parseInt(localStorage.getItem('basicInterval')) || CONFIG.BASIC_INTERVAL,
        operationInterval: parseInt(localStorage.getItem('operationInterval')) || CONFIG.OPERATION_INTERVAL,

        async startProcessing() {
            if (location.pathname.includes('/jobs'))
                await this.autoScrollJobList();

            while (state.isRunning) {
                if (location.pathname.includes('/jobs'))
                    await this.processJobList();
                else if (location.pathname.includes('/chat'))
                    await this.handleChatPage();
                await this.delay(this.basicInterval);
            }
        },

        async autoScrollJobList() {
            return new Promise((resolve) => {
                const cardSelector = 'li.job-card-box';
                const maxHistory = 3;
                const waitTime = this.basicInterval;
                let cardCountHistory = [];
                let isStopped = false;
                let attempts = 0;

                // 安全阀：岗位卡片数持续增长时历史永不重复，原实现会无限递归，
                // 导致 startProcessing() 的主循环永远进不去。设上限兜底。
                const MAX_ATTEMPTS = 200;

                const scrollStep = async () => {
                    if (isStopped) return;
                    if (++attempts > MAX_ATTEMPTS) {
                        const cards = document.querySelectorAll(cardSelector);
                        this.log(`⚠️ 滚动已达上限 ${MAX_ATTEMPTS} 次，以当前 ${cards.length} 个岗位继续`);
                        resolve(cards);
                        return;
                    }
                    window.scrollTo({
                        top: document.documentElement.scrollHeight,
                        behavior: 'smooth'
                    });
                    await this.delay(waitTime);
                    if (isStopped) return;   // delay 期间可能已被停止，提前退出递归
                    const cards = document.querySelectorAll(cardSelector);
                    const currentCount = cards.length;
                    cardCountHistory.push(currentCount);
                    if (cardCountHistory.length > maxHistory) cardCountHistory.shift();
                    if (cardCountHistory.length === maxHistory && new Set(cardCountHistory).size === 1) {
                        const filtered = Array.from(cards).filter(card => FilterUtils.matchesAllFilters(card));
                        this.log(`已加载 ${cards.length} 个岗位，符合筛选条件 ${filtered.length} 个，开始沟通`);
                        resolve(cards);
                        return;
                    }
                    await scrollStep();
                };

                // 停止入口：点击"停止海投"时由 toggleProcess() 调用
                this.stopAutoScroll = () => {
                    isStopped = true;
                    resolve(document.querySelectorAll(cardSelector));
                };

                scrollStep();
            });
        },

        async processJobList() {
            const allCards = Array.from(document.querySelectorAll('li.job-card-box'));
            state.jobList = allCards.filter(card => FilterUtils.matchesAllFilters(card));

            if (!state.jobList.length) {
                this.log('⚠️ 没有符合筛选条件的职位，请调整筛选条件');
                this.log(`   当前页面共 ${allCards.length} 个岗位，全部被过滤`);
                __BH__.toggleProcess();
                return;
            }

            if (state.currentIndex >= state.jobList.length) {
                this.resetCycle();
                return;
            }

            const currentCard = state.jobList[state.currentIndex];
            const jobInfo = FilterUtils.extractJobInfo(currentCard);
            const keys = this.jobKeys(jobInfo);

            // 检查是否已经投递过：任一 key 形式命中即视为已投
            const hitKey = keys.find((k) => state.appliedJobs.has(k));
            if (hitKey) {
                this.log(`⏭️ 已投递过，跳过 [${jobInfo.title}] - ${jobInfo.companyName}`);
                state.currentIndex++;
                await this.delay(500);
                return;
            }

            currentCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            currentCard.click();
            this.log(`📋 正在沟通 [${jobInfo.title}] ${jobInfo.salary} - ${jobInfo.companyName} (${++state.currentIndex}/${state.jobList.length})`);
            await this.delay(this.operationInterval);

            const chatBtn = document.querySelector('a.op-btn-chat');
            if (chatBtn) {
                const btnText = chatBtn.textContent.trim();
                if (btnText === '立即沟通') {
                    // 点击前先检查JD内容是否包含排除关键词
                    const jd = this.extractCurrentJD();
                    const fullText = `${jd.title} ${jd.description} ${jd.requirements}`;
                    const matchedBadWords = FilterUtils.smartMatchExclude(fullText, state.filters.excludeContentKeywords);

                    if (matchedBadWords.length > 0) {
                        this.log(`🚫 跳过：JD命中排除词[${matchedBadWords.join(', ')}] - [${jobInfo.title}] ${jobInfo.companyName}`);
                        state.currentIndex++;
                        await this.delay(500);
                        return;
                    }

                    chatBtn.click();
                    await this.handleGreetingModal();

                    // 记录已投递：同时写入岗位 ID 与标题标识。
                    // 双写的原因见 jobKeys() 注释 —— 任一形式命中即可判重。
                    for (const k of keys) state.appliedJobs.add(k);
                    localStorage.setItem('appliedJobs', JSON.stringify([...state.appliedJobs]));
                    this.log(`✅ 已投递并记录 [${jobInfo.title}] - ${jobInfo.companyName} (累计 ${state.appliedJobs.size} 个)`);
                }
            }
        },

        // 生成一条岗位的**全部**候选去重标识。
        //
        // 为什么返回多个而不是一个：
        //   1. 岗位 ID 最可靠（平台内唯一），但历史记录里没有它
        //   2. 旧记录用的是 `标题-公司名`
        //   3. 公司名选择器曾长期失效，那段时期存进去的是**纯标题**
        // 任一命中即判为已投，写入时全部写入，使新旧记录互相兼容。
        //
        // ⚠️ 关于"纯标题"标识的严格限制（此处踩过坑）：
        // 纯标题**不能**无条件参与判重 —— 不同公司的同名岗位会被误判为重复，
        // 而那正是本方法要修复的 bug 本身。因此仅当**当前岗位也抓不到公司名**
        // 时才使用纯标题匹配：此时两边都是"标题"，确实是同一条记录的特征。
        // 一旦公司名可解析，就必须依赖 jobId 或"标题-公司名"来判重。
        jobKeys(jobInfo) {
            const keys = [];
            const t = (jobInfo.title || '').trim().toLowerCase();
            const c = (jobInfo.companyName || '').trim().toLowerCase();

            if (jobInfo.jobId) keys.push(`id:${jobInfo.jobId}`);
            if (t && c) keys.push(`${t}-${c}`);
            // 仅在两边都缺公司名时才退回纯标题匹配（兼容公司名失效期的历史记录）
            if (t && !c) keys.push(t);
            return keys;
        },

        async handleGreetingModal() {
            await this.delay(this.operationInterval);
            const btn = [...document.querySelectorAll(SEL.GREETING_MODAL_CANCEL)]
                .find(b => b.textContent.trim() === '留在此页');
            if (btn) {
                btn.click();
                await this.delay(this.operationInterval);
            }
        },

        async handleChatPage() {
            const chatList = await this.waitForElement(SEL.CHAT.chatList);
            if (!chatList) {
                this.log('没有聊天列表');
                return;
            }
            const observer = new MutationObserver(async () => {
                await this.clickLatestChat();
            });
            observer.observe(chatList, { childList: true });
            await this.clickLatestChat();
        },

        getLatestChatLi() {
            return document.querySelector(SEL.CHAT.latestChatItem);
        },

        async clickLatestChat() {
            try {
                const latestLi = await this.waitForElement(this.getLatestChatLi);
                if (!latestLi) return;
                const nameEl = latestLi.querySelector(SEL.CHAT.friendName);
                const companyEl = latestLi.querySelector(SEL.CHAT.friendCompany);
                const name = (nameEl?.textContent || '未知').trim().replace(/\s+/g, ' ');
                const company = (companyEl?.textContent || '').trim().replace(/\s+/g, ' ');
                const hrKey = `${name}-${company}`.toLowerCase();

                if (state.currentTopHRKey === hrKey) return;
                state.currentTopHRKey = hrKey;

                if (state.processedHRs.has(hrKey)) {
                    this.log(`发过简历: ${name}${company ? ' - ' + company : ''}`);
                    const avatar = latestLi.querySelector(SEL.CHAT.avatar);
                    await this.simulateClick(avatar);
                    latestLi.classList.add('last-clicked');
                    await this.aiReply();
                    return;
                }

                if (latestLi.classList.contains('last-clicked')) return;
                this.log(`开始沟通 ${name}${company ? '， 公司名: ' + company : ''}`);
                const avatar = latestLi.querySelector(SEL.CHAT.avatar);
                await this.simulateClick(avatar);
                latestLi.classList.add('last-clicked');
                const isResumeSent = await this.processChatContent();
                if (isResumeSent) {
                    state.processedHRs.add(hrKey);
                    localStorage.setItem('processedHRs', JSON.stringify([...state.processedHRs]));
                }
            } catch (error) {
                this.log(`沟通出错: ${error.message}`);
            }
        },

        async aiReply() {
            try {
                await this.delay(250);
                const lastMessage = await this.getLastFriendMessageText();
                if (!lastMessage) return false;
                this.log(`对方: ${lastMessage}`);

                const today = new Date().toISOString().split('T')[0];
                if (state.lastAiDate !== today) {
                    state.aiReplyCount = 0;
                    state.lastAiDate = today;
                    localStorage.setItem('aiReplyCount', state.aiReplyCount);
                    localStorage.setItem('lastAiDate', state.lastAiDate);
                }

                const maxReplies = 5;
                if (state.aiReplyCount >= maxReplies) {
                    this.log('今日AI回复已达上限');
                    return false;
                }

                let aiReplyText;
                try {
                    aiReplyText = await this.requestAi(lastMessage);
                } catch (aiError) {
                    this.log('❌ AI回复失败: ' + aiError.message);
                    return false;
                }
                if (!aiReplyText) return false;

                this.log(`AI回复: ${aiReplyText.slice(0, 30)}...`);
                state.aiReplyCount++;
                localStorage.setItem('aiReplyCount', state.aiReplyCount);
                localStorage.setItem('lastAiDate', state.lastAiDate);

                const inputBox = await this.waitForElement('#chat-input');
                if (!inputBox) return false;
                inputBox.textContent = '';
                inputBox.focus();
                document.execCommand('insertText', false, aiReplyText);
                await this.delay(250);

                const sendButton = document.querySelector(SEL.CHAT.sendButton);
                if (sendButton) {
                    await this.simulateClick(sendButton);
                } else {
                    const enterKeyEvent = new KeyboardEvent('keydown', {
                        key: 'Enter',
                        keyCode: 13,
                        code: 'Enter',
                        which: 13,
                        bubbles: true
                    });
                    inputBox.dispatchEvent(enterKeyEvent);
                }
                return true;
            } catch (error) {
                this.log(`AI回复出错: ${error.message}`);
                return false;
            }
        },

        // 获取AI配置（优先用用户自定义的）
        getAIConfig() {
            // 运行期覆盖优先：设置面板保存时会写入 customApiKeyOverride /
            // customApiUrlOverride / customModelOverride，使新配置**立即生效**，
            // 不必刷新页面。原实现只读启动时写入的 customApi*，用户保存后
            // 仍走旧配置，容易误判为"Key 不生效"。
            const customApiKey = localStorage.getItem('customApiKeyOverride')
                || localStorage.getItem('customApiKey') || '';
            const customApiUrl = localStorage.getItem('customApiUrlOverride')
                || localStorage.getItem('customApiUrl') || '';
            const customModel = localStorage.getItem('customModelOverride')
                || localStorage.getItem('customModel') || '';
            const useCustom = !!(customApiKey && customApiUrl);

            // 共享回落配置：来自 00a-local-config.js（可选文件，默认不含凭据）。
            // 此前这里硬编码了原作者混淆过的讯飞凭据，属于他人凭据且已公开
            // 发布，现改为外部可选配置 —— 代码中不再包含任何凭据。
            const local = (typeof __BH__ !== 'undefined' && __BH__.LOCAL_CONFIG) || {};
            const sharedToken = local.SHARED_FALLBACK_TOKEN || '';

            return {
                apiKey: useCustom ? customApiKey : sharedToken,
                apiUrl: useCustom
                    ? customApiUrl
                    : (local.SHARED_FALLBACK_URL || 'https://spark-api-open.xf-yun.com/v1/chat/completions'),
                model: useCustom
                    ? (customModel || 'gpt-3.5-turbo')
                    : (local.SHARED_FALLBACK_MODEL || 'lite'),
                useCustom: useCustom,
                // 既没用自定义 Key、也没有共享回落 → 无可用凭据
                isDefault: !useCustom && !!sharedToken,
                hasNoKey: !useCustom && !sharedToken
            };
        },

        // 检查是否达到次数限制（只有用共享回落 token 才限制）
        checkRateLimit() {
            const config = this.getAIConfig();

            // 没有任何可用凭据：明确拒绝，而不是带着空 Key 发请求
            if (config.hasNoKey) {
                return { allowed: false, remaining: 0, reason: 'no-key' };
            }
            if (config.useCustom) return { allowed: true, remaining: -1 };

            const today = new Date().toISOString().split('T')[0];
            if (state.lastAiDate !== today) {
                state.aiReplyCount = 0;
                state.lastAiDate = today;
                localStorage.setItem('aiReplyCount', '0');
                localStorage.setItem('lastAiDate', today);
            }

            const remaining = CONFIG.AI.MAX_REPLIES_FREE - state.aiReplyCount;
            return {
                allowed: remaining > 0,
                remaining: remaining,
                reason: remaining > 0 ? 'ok' : 'quota'
            };
        },

        // 无可用凭据时统一的提示文案
        NO_KEY_MESSAGE: '尚未配置 API Key：请点面板 ⚙ →「🔑 API 设置」填入自己的 Key'
            + '（可用 DeepSeek / 智谱 等，推荐点「🔌 测试连接」验证）',

        // 记录一次AI调用
        recordAiUsage() {
            const config = this.getAIConfig();
            if (config.useCustom) return; // 自定义key不计数

            state.aiReplyCount++;
            localStorage.setItem('aiReplyCount', String(state.aiReplyCount));
        },

        // 共享的 Chat Completions 调用。
        // 原先 requestAi / requestAiWithSystem 各自复制了一份完全相同的
        // HTTP 与响应解析逻辑，任何修复都得改两处，容易漏改。此处收敛为一处。
        //
        // 注意：本方法只负责发请求与解析，**不检查额度、不计数**，
        // 由调用方决定是否计入用量（测试连接就不应计入）。
        async _chatCompletion({ apiUrl, apiKey, model, messages, maxTokens }) {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + apiKey
                },
                body: JSON.stringify({
                    model,
                    messages,
                    temperature: 0.9,
                    top_p: 0.8,
                    max_tokens: maxTokens
                })
            });

            // 有些错误响应体不是 JSON（如网关返回 HTML），直接 response.json()
            // 会抛出难以理解的解析错误。这里先取文本再尝试解析，失败时
            // 把 HTTP 状态与响应片段带进错误信息，便于定位。
            const raw = await response.text();
            let result;
            try {
                result = JSON.parse(raw);
            } catch (e) {
                throw new Error(`API返回非JSON（HTTP ${response.status}）: ${raw.slice(0, 200)}`);
            }

            // 兼容不同API的返回格式
            if (result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content) {
                return result.choices[0].message.content.trim();
            }
            if (result.result) {
                return result.result.trim();
            }
            if (result.data && result.data.content) {
                return result.data.content.trim();
            }
            if (result.code !== undefined && result.code !== 0) {
                throw new Error('API错误: ' + (result.message || result.msg || '未知错误'));
            }
            if (result.error) {
                const e = result.error;
                throw new Error('API错误: ' + (typeof e === 'string' ? e : (e.message || JSON.stringify(e))));
            }
            throw new Error(`API返回格式异常（HTTP ${response.status}）`);
        },

        // 测试连接：用设置面板里**当前输入框**的值发一次最小请求。
        // 目的是让用户填完 Key 立刻知道是否可用，而不是投递时才发现失败。
        // 明确不检查额度、不计入用量、不读取 localStorage 里的旧配置。
        async testAIConnection({ apiUrl, apiKey, model }) {
            if (!apiUrl || !apiKey) {
                throw new Error('API 地址和 API Key 都需要填写');
            }
            const content = await this._chatCompletion({
                apiUrl,
                apiKey,
                model: model || 'deepseek-chat',
                messages: [
                    { role: 'system', content: '你是一个测试助手。' },
                    { role: 'user', content: '请只回复两个字：可用' }
                ],
                maxTokens: 16
            });
            return content;
        },

        async requestAi(message) {
            const config = this.getAIConfig();

            // 检查限制
            const limit = this.checkRateLimit();
            if (!limit.allowed) {
                throw new Error(limit.reason === 'no-key'
                    ? this.NO_KEY_MESSAGE
                    : '今日免费额度已用完，请在设置中配置自己的API Key');
            }

            try {
                const content = await this._chatCompletion({
                    apiUrl: config.apiUrl,
                    apiKey: config.apiKey,
                    model: config.model,
                    messages: [
                        {
                            role: 'system',
                            content: localStorage.getItem('aiRole') || CONFIG.AI.DEFAULT_ROLE
                        },
                        {
                            role: 'user',
                            content: message
                        }
                    ],
                    maxTokens: 512
                });
                this.recordAiUsage();
                return content;
            } catch (error) {
                console.error('AI请求失败:', error);
                throw error;
            }
        },

        // ========== JD提取 & 打招呼语生成 ==========

        // 提取当前岗位的JD信息
        extractCurrentJD() {
            // 与 10-filters.js 同理：同时认旧名与真实页面类名。
            // 详情页与列表页的类名不同，因此这里的选择器覆盖面更宽。
            const pick = (sels) => {
                for (const s of sels) {
                    const el = document.querySelector(s);
                    if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
                }
                return '';
            };

            const jd = {
                title: pick(SEL.JOB_DETAIL.title),
                salary: pick(SEL.JOB_DETAIL.salary),
                company: pick(SEL.JOB_DETAIL.company),
                description: '',
                requirements: ''
            };

            // 尝试提取职位描述 (不同页面结构可能不同)
            const jdSelectors = SEL.JOB_DETAIL.description;

            for (const selector of jdSelectors) {
                const el = document.querySelector(selector);
                if (el && el.textContent.trim().length > 20) {
                    jd.description = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 3000);
                    break;
                }
            }

            // 如果没找到，尝试从所有文本中提取
            if (!jd.description) {
                // 兜底：innerText 依赖布局引擎，并非在所有环境都可用
                //（例如 jsdom 中为 undefined）。缺失时退回 textContent，
                // 避免一次 TypeError 中断整个岗位的处理流程。
                const allText = document.body.innerText || document.body.textContent || '';
                const idxOf = (kw) => allText.indexOf(kw);
                const markerHits = SEL.JD_TEXT_MARKERS.map(idxOf).filter(i => i > -1);
                const jdStart = markerHits.length ? Math.min(...markerHits) : -1;
                if (jdStart > -1) {
                    jd.description = allText.slice(jdStart, jdStart + 3000).replace(/\s+/g, ' ');
                }
            }

            // 提取任职要求
            const reqSelectors = SEL.JOB_DETAIL.requirements;
            for (const selector of reqSelectors) {
                const el = document.querySelector(selector);
                if (el && el.textContent.trim().length > 10) {
                    jd.requirements = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 1500);
                    break;
                }
            }

            state.currentJD = jd;
            return jd;
        },

        // AI生成个性化打招呼语
        //
        // 设计要点（与本仓库 skill「greeting-writer」的要求一致）：
        //   1. 必须带入**简历全文**。结构化字段只有 7 个短字段，且常为
        //      "未填写"；只靠它们时 AI 无据可依，必然编造。全文里才有
        //      项目名、技术栈、量化结果等可引用的证据。
        //   2. prompt 中明确禁止编造，并要求 AI 标注每条能力点的出处，
        //      使"有没有编"变成可核对的事实。
        //   3. 岗位描述用全文（不再截断到 1000 字符），否则 JD 的后半段
        //      要求（常含任职要求）会被丢掉，导致回应不中要害。
        async generateGreeting() {
            const jd = this.extractCurrentJD();
            const resume = state.resume;
            const rawText = this.getResumeRawText();

            // 有全文就以全文为准；否则退回结构化字段
            if (!rawText && !resume.skills && !resume.highlight) {
                this.log('⚠️ 请先在设置中上传简历（PDF）或粘贴简历文本');
                this.log('💡 只有简历全文才能生成有针对性的招呼语');
                return null;
            }

            if (!jd.title) {
                this.log('⚠️ 未检测到岗位信息，请先打开岗位详情页');
                return null;
            }

            this.log(`🤖 正在为「${jd.title}」生成个性化打招呼语...`);

            // JD 全文（描述 + 任职要求），不截断
            const jdFull = [jd.description, jd.requirements].filter(Boolean).join('\n');

            // 简历：优先全文；同时附上结构化字段作为补充线索
            const resumeBlock = rawText
                ? `【简历全文】\n${rawText}`
                : `【简历（仅有结构化字段，证据有限，务必保守）】
技能栈：${resume.skills || '未填写'}
核心亮点：${resume.highlight || '未填写'}`;

            const structuredHints = [
                resume.name && `姓名：${resume.name}`,
                resume.yearsOfExp && `工作年限：${resume.yearsOfExp}`,
                resume.education && `学历：${resume.education}`,
                resume.currentCompany && `当前/上一家公司：${resume.currentCompany}`,
                resume.targetPosition && `目标岗位：${resume.targetPosition}`,
            ].filter(Boolean).join('\n');

            const userPrompt = `【岗位信息】
职位：${jd.title}
公司：${jd.company || '（未知）'}
薪资：${jd.salary || '（未知）'}
岗位描述与要求：
${jdFull || '（未抓取到详细描述，请仅依据职位名称判断，并保持措辞保守）'}

${resumeBlock}
${structuredHints ? '\n【结构化信息（补充线索）】\n' + structuredHints : ''}

【任务】
写一句打招呼开场白，要求：
1. 必须回应上面「岗位描述与要求」中**真实写出的**至少一条具体要求
2. 必须引用简历中**真实存在**的经历或技能，并在末尾用「依据：」列出引用了简历的哪一句
3. 严禁编造简历中没有的数字、学历、年限、公司名、项目角色
4. 一句话，40-70 字，像真人在说话，不要模板腔
5. 若简历与该岗位匹配度低，用「有相关项目经验 + 学习速度」的务实说法，不要硬说自己完全符合

输出格式（只输出这两行）：
招呼语：<正文>
依据：<引用的简历原句>`;

            try {
                const greeting = await this.requestAiWithSystem(
                    CONFIG.AI.GREETING_PROMPT,
                    userPrompt
                );

                if (greeting) {
                    this.log(`✅ 打招呼语生成成功：${greeting}`);
                    return greeting;
                } else {
                    this.log('❌ 打招呼语生成失败，请稍后重试');
                    return null;
                }
            } catch (error) {
                this.log('❌ 打招呼语生成失败: ' + error.message);
                this.log('💡 请在设置→API设置中配置自己的API Key');
                return null;
            }
        },

        // 带自定义system prompt的AI请求
        //
        // maxTokens 可传参覆盖。原实现硬编码 200，导致"简历结构化"这类需要
        // 输出较长 JSON 的场景被中途截断 —— 返回的 JSON 不完整，
        // JSON.parse 抛错，表现为"AI解析失败"。默认提到 512。
        async requestAiWithSystem(systemPrompt, userMessage, maxTokens = 512) {
            const config = this.getAIConfig();

            // 检查限制
            const limit = this.checkRateLimit();
            if (!limit.allowed) {
                throw new Error(limit.reason === 'no-key'
                    ? this.NO_KEY_MESSAGE
                    : '今日免费额度已用完，请在设置中配置自己的API Key');
            }

            try {
                const content = await this._chatCompletion({
                    apiUrl: config.apiUrl,
                    apiKey: config.apiKey,
                    model: config.model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userMessage }
                    ],
                    maxTokens
                });
                this.recordAiUsage();
                return content;
            } catch (error) {
                console.error('AI请求失败:', error);
                throw error;
            }
        },

        // 从 AI 返回的文本中稳健地提取 JSON 对象。
        //
        // 为什么不能直接 JSON.parse：
        //   1. 模型常把 JSON 包在 ```json 围栏里
        //   2. 模型可能在 JSON 前后加一句说明文字
        //   3. max_tokens 偏小时 JSON 会被**中途截断**，末尾不完整
        // 前两种可以清理，第三种无法恢复 —— 只能靠调用方给足 maxTokens，
        // 这里至少给出可读的错误，便于定位。
        extractJson(text) {
            if (!text) throw new Error('AI 返回为空');
            let s = String(text).trim();

            // 去掉 markdown 代码围栏
            s = s.replace(/```json/gi, '').replace(/```/g, '').trim();

            // 直接尝试
            try { return JSON.parse(s); } catch (_) { /* 继续 */ }

            // 截取第一个 { 到最后一个 }
            const start = s.indexOf('{');
            const end = s.lastIndexOf('}');
            if (start >= 0 && end > start) {
                const slice = s.slice(start, end + 1);
                try { return JSON.parse(slice); } catch (_) { /* 继续 */ }
            }

            // 判断是否为截断
            const looksTruncated = start >= 0 && (end <= start);
            throw new Error(looksTruncated
                ? 'AI 返回的 JSON 不完整（可能被 max_tokens 截断），请重试或更换模型'
                : 'AI 返回的内容不是合法 JSON');
        },

        // 保存简历信息
        // 关键：同时保留**简历全文**（rawText）。
        // 结构化字段只有 7 个短字段，且用户简历常缺姓名/学历/工作年限，
        // 这些字段会变成"未填写"。只靠它们生成招呼语时，AI 拿不到任何
        // 具体证据，只能编造 —— 这正是招呼语质量差的根因。
        // 全文里才有项目名、技术栈、量化结果等真正可引用的证据。
        saveResume(resumeData) {
            Object.assign(state.resume, resumeData);
            localStorage.setItem('bossResume', JSON.stringify(state.resume));
        },

        // 保存简历全文（与结构化字段分开存储，避免把长文本混进表单）
        saveResumeRawText(text) {
            const trimmed = (text || '').trim();
            if (!trimmed) return;
            // localStorage 单域上限约 5MB，简历留 8000 字符足够且安全
            const capped = trimmed.slice(0, 8000);
            state.resume.rawText = capped;
            localStorage.setItem('bossResumeRawText', capped);
            this.log(`📄 已保存简历全文 ${capped.length} 字符（供生成招呼语引用具体经历）`);
        },

        // 读取简历全文
        getResumeRawText() {
            return (state.resume && state.resume.rawText)
                || localStorage.getItem('bossResumeRawText') || '';
        },

        // PDF简历解析：从扩展本地加载pdf.js提取文本，然后AI结构化
        async parsePdfResume(file) {
            this.log('📄 正在读取PDF文件...');
            let fullText = '';
            try {
                const arrayBuffer = await file.arrayBuffer();

                // pdf.js 已通过 manifest 的 content_scripts 加载，直接使用
                if (typeof globalThis.pdfjsLib === 'undefined') {
                    this.log('❌ PDF.js 未加载，请检查扩展是否完整（lib/pdf.min.js）');
                    return null;
                }

                const pdf = await globalThis.pdfjsLib.getDocument({ data: arrayBuffer }).promise;

                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const content = await page.getTextContent();
                    const pageText = content.items.map(item => item.str).join(' ');
                    fullText += pageText + '\n';
                }

                if (!fullText.trim()) {
                    this.log('⚠️ PDF中未提取到文本（可能是扫描件），请用粘贴文本方式或手动填写');
                    return null;
                }

                this.log(`📄 提取到 ${fullText.length} 字符`);
            } catch (error) {
                this.log('❌ PDF读取失败: ' + error.message);
                this.log('💡 可尝试粘贴文本方式解析');
                return null;
            }

            // 无论后续 AI 解析成功与否，先把全文保存下来 ——
            // resume.rawText 是生成个性化招呼语的证据来源
            this.saveResumeRawText(fullText);

            // 尝试用AI解析
            try {
                this.log('🤖 正在用AI解析简历...');
                const parsePrompt = `你是一个简历解析器。请从以下简历文本中提取结构化信息，严格按JSON格式输出，不要输出其他内容。

要求提取的字段：
{
  "name": "姓名",
  "yearsOfExp": "工作年限（如：3年）",
  "education": "最高学历（如：本科/硕士）",
  "currentCompany": "当前或上一家公司名",
  "targetPosition": "目标岗位",
  "skills": "技能栈，逗号分隔（如：React,Vue,TypeScript）",
  "highlight": "核心亮点，1-2句话总结最突出的项目经历或成就"
}

如果某个字段无法提取，留空字符串。直接输出JSON，不要markdown格式。`;

                const result = await this.requestAiWithSystem(parsePrompt, fullText.slice(0, 3000), 1200);

                if (result) {
                    const parsed = this.extractJson(result);
                    this.log(`✅ 简历解析成功：${parsed.name || '未知'} | ${parsed.yearsOfExp || ''} | ${parsed.skills?.slice(0, 50) || ''}`);
                    return parsed;
                }
            } catch (error) {
                this.log('⚠️ AI解析失败: ' + error.message);
                // 即使AI解析失败，也尝试正则提取基本信息
                this.log('💡 尝试从PDF文本中直接提取...');
                const fallback = this._fallbackParseResume(fullText);
                if (fallback) {
                    this.log('✅ 基础信息提取成功（建议手动补充）');
                    return fallback;
                }
                this.log('💡 请在设置中配置API Key后重试，或手动填写简历信息');
            }
            return null;
        },

        // 从粘贴的文本解析简历
        async parseTextResume(text) {
            this.log('🤖 正在解析简历文本...');
            if (!text || text.trim().length < 10) {
                this.log('⚠️ 文本内容太少');
                return null;
            }

            // 与 PDF 路径一致：先保存全文，作为招呼语的证据来源
            this.saveResumeRawText(text);

            try {
                const parsePrompt = `你是一个简历解析器。请从以下简历文本中提取结构化信息，严格按JSON格式输出，不要输出其他内容。

要求提取的字段：
{
  "name": "姓名",
  "yearsOfExp": "工作年限（如：3年）",
  "education": "最高学历（如：本科/硕士）",
  "currentCompany": "当前或上一家公司名",
  "targetPosition": "目标岗位",
  "skills": "技能栈，逗号分隔（如：React,Vue,TypeScript）",
  "highlight": "核心亮点，1-2句话总结最突出的项目经历或成就"
}

如果某个字段无法提取，留空字符串。直接输出JSON，不要markdown格式。`;

                const result = await this.requestAiWithSystem(parsePrompt, text.slice(0, 3000), 1200);

                if (result) {
                    const parsed = this.extractJson(result);
                    this.log(`✅ 简历解析成功：${parsed.name || '未知'} | ${parsed.yearsOfExp || ''} | ${parsed.skills?.slice(0, 50) || ''}`);
                    return parsed;
                }
            } catch (error) {
                this.log('⚠️ AI解析失败: ' + error.message);
                this.log('💡 尝试正则提取...');
                const fallback = this._fallbackParseResume(text);
                if (fallback) {
                    this.log('✅ 基础信息提取成功（建议手动补充）');
                    return fallback;
                }
                this.log('💡 请在设置中配置API Key，或手动填写简历信息');
            }
            return null;
        },

        // 简历正则兜底解析（无API也可用）
        _fallbackParseResume(text) {
            const result = {
                name: '', yearsOfExp: '', education: '', currentCompany: '',
                targetPosition: '', skills: '', highlight: ''
            };

            // 姓名：常见格式
            const nameMatch = text.match(/姓\s*名[：:]\s*(\S+)/) || text.match(/^([^\s,，。]{2,4})$/m);
            if (nameMatch) result.name = nameMatch[1];

            // 工作年限
            const expMatch = text.match(/(\d+)\s*年/) || text.match(/工作[经验][:：]\s*(\d+\s*年)/);
            if (expMatch) result.yearsOfExp = expMatch[0].includes('工作') ? expMatch[0].replace(/工作[经验][:：]\s*/, '') : expMatch[0];

            // 学历
            const eduMatch = text.match(/(博士|硕士|本科|大专|MBA)/);
            if (eduMatch) result.education = eduMatch[1];

            // 技能：查找常见技术词
            // ⚠️ 必须转义后再构造正则。原实现在列表里写 'C\+\+'，
            // 但字符串字面量里的 \+ 就是 +，实际值是 'C++'，
            // 而 new RegExp('C++') 会抛 "Nothing to repeat" ——
            // 导致这个兜底解析在 AI 失败时整个崩掉（真机已复现）。
            const techKeywords = ['JavaScript', 'TypeScript', 'Python', 'Java', 'Go', 'Rust', 'C++', 'React', 'Vue', 'Angular',
                'Node', 'Spring', 'Django', 'MySQL', 'Redis', 'Docker', 'Kubernetes', 'AWS', 'Linux', 'Git'];
            const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const found = techKeywords.filter((t) => {
                try { return new RegExp(escRe(t), 'i').test(text); } catch (_) { return false; }
            });
            if (found.length) result.skills = found.join(',');

            // 至少有姓名或技能才算提取成功
            if (!result.name && !result.skills) return null;
            return result;
        },

        // 查看当前岗位JD详情
        viewCurrentJD() {
            const jd = this.extractCurrentJD();

            const modal = document.createElement('div');
            modal.style.cssText = `
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.5); z-index: 999998;
                display: flex; align-items: center; justify-content: center;
            `;

            const box = document.createElement('div');
            box.style.cssText = `
                width: 90%; max-width: 500px; max-height: 80vh;
                background: white; border-radius: 16px;
                display: flex; flex-direction: column; overflow: hidden;
                font-family: 'Segoe UI', sans-serif;
            `;

            const header = document.createElement('div');
            header.style.cssText = `
                padding: 15px 20px; background: var(--primary-color);
                color: white; font-size: 16px; font-weight: 600;
                display: flex; justify-content: space-between; align-items: center;
            `;
            header.textContent = `📋 ${jd.title || '岗位详情'}`;

            const closeBtn = document.createElement('button');
            closeBtn.innerHTML = '✕';
            closeBtn.style.cssText = 'background:transparent;color:white;border:none;font-size:18px;cursor:pointer;';
            closeBtn.addEventListener('click', () => modal.remove());
            header.appendChild(closeBtn);

            const body = document.createElement('div');
            body.style.cssText = 'padding: 20px; overflow-y: auto; font-size: 14px; line-height: 1.6;';

            if (jd.salary) {
                body.innerHTML += `<div style="margin-bottom:10px;"><span style="color:#6b7280;font-size:13px;">薪资：</span><span style="color:#e91e63;font-weight:600;">${jd.salary}</span></div>`;
            }
            if (jd.company) {
                body.innerHTML += `<div style="margin-bottom:10px;"><span style="color:#6b7280;font-size:13px;">公司：</span><span style="font-weight:500;">${jd.company}</span></div>`;
            }
            if (jd.description) {
                body.innerHTML += `<div style="margin-bottom:15px;"><div style="color:#6b7280;font-size:13px;margin-bottom:5px;">职位描述：</div><div style="color:#374151;">${jd.description}</div></div>`;
            }
            if (jd.requirements) {
                body.innerHTML += `<div style="margin-bottom:15px;"><div style="color:#6b7280;font-size:13px;margin-bottom:5px;">任职要求：</div><div style="color:#374151;">${jd.requirements}</div></div>`;
            }
            if (!jd.description && !jd.requirements) {
                body.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:40px 0;">未检测到JD内容，请先点开岗位详情页</div>';
            }

            // 智能排除词检查
            const fullText = `${jd.title} ${jd.description} ${jd.requirements}`;
            const matchedWords = FilterUtils.smartMatchExclude(fullText, state.filters.excludeContentKeywords);

            if (matchedWords.length > 0) {
                const warning = document.createElement('div');
                warning.style.cssText = `
                    margin-top: 15px; padding: 10px 12px;
                    background: #fef2f2; border: 1px solid #fecaca;
                    border-radius: 8px; color: #991b1b; font-size: 13px;
                `;
                warning.innerHTML = `⚠️ <strong>检测到以下排除关键词：</strong><br>${matchedWords.map(w => `<span style="display:inline-block;background:#fee2e2;padding:2px 8px;border-radius:4px;margin:2px;">${w}</span>`).join('')}`;
                body.appendChild(warning);
            } else {
                const ok = document.createElement('div');
                ok.style.cssText = `
                    margin-top: 15px; padding: 10px 12px;
                    background: #f0fdf4; border: 1px solid #bbf7d0;
                    border-radius: 8px; color: #166534; font-size: 13px;
                `;
                ok.textContent = '✅ 未检测到排除关键词，该岗位可以投递';
                body.appendChild(ok);
            }

            const footer = document.createElement('div');
            footer.style.cssText = 'padding: 12px 20px; border-top: 1px solid #e5e7eb; display:flex; gap:10px;';

            const closeBtn2 = document.createElement('button');
            closeBtn2.textContent = '关闭';
            closeBtn2.style.cssText = 'flex:1;padding:8px;border:1px solid #d1d5db;border-radius:8px;cursor:pointer;background:white;color:#374151;';
            closeBtn2.addEventListener('click', () => modal.remove());

            const genBtn = document.createElement('button');
            genBtn.textContent = '✨ 生成打招呼语';
            genBtn.style.cssText = 'flex:1;padding:8px;border:none;border-radius:8px;cursor:pointer;background:linear-gradient(45deg,#9c27b0,#e91e63);color:white;font-weight:600;';
            genBtn.addEventListener('click', async () => {
                modal.remove();
                const greeting = await this.generateGreeting();
                if (greeting) {
                    try { await navigator.clipboard.writeText(greeting); } catch(e) {}
                }
            });

            footer.append(closeBtn2, genBtn);
            box.append(header, body, footer);
            modal.appendChild(box);
            modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
            document.body.appendChild(modal);
        },

        // 清除投递记录
        clearAppliedJobs() {
            state.appliedJobs.clear();
            localStorage.removeItem('appliedJobs');
            this.log('🗑️ 已清除全部投递记录');
        },

        async getLastFriendMessageText() {
            try {
                await this.delay(250);
                const chatContainer = document.querySelector(SEL.CHAT.messageListA);
                if (!chatContainer) return null;
                const messageItems = Array.from(chatContainer.querySelectorAll(SEL.CHAT.messageListB));
                const friendMessages = messageItems.filter(item =>
                    item.classList.contains('item-friend')
                );
                if (friendMessages.length === 0) return null;
                const lastFriendMessage = friendMessages[friendMessages.length - 1];
                const spanEl = lastFriendMessage.querySelector(SEL.CHAT.friendMessageText);
                if (!spanEl) return null;
                return spanEl.textContent.trim();
            } catch (error) {
                return null;
            }
        },

        async processChatContent() {
            try {
                await this.delay(250);
                const dictBtn = await this.waitForElement(SEL.CHAT.commonPhraseButton);
                if (!dictBtn) {
                    this.log('未找到常用语按钮');
                    return false;
                }
                await this.simulateClick(dictBtn);
                await this.delay(250);

                const dictList = await this.waitForElement(SEL.CHAT.commonPhraseList);
                if (!dictList) {
                    this.log('未找到常用语列表');
                    return false;
                }
                const dictItems = dictList.querySelectorAll('li');
                if (!dictItems || dictItems.length === 0) {
                    this.log('常用语列表为空');
                    return false;
                }

                for (let i = 0; i < dictItems.length; i++) {
                    const item = dictItems[i];
                    this.log(`发送常用语：第${i + 1}条/共${dictItems.length}条`);
                    await this.simulateClick(item);
                    await this.delay(250);
                }

                const resumeBtn = await this.waitForElement(() => {
                    return [...document.querySelectorAll(SEL.CHAT.toolbarButton)].find(
                        el => el.textContent.trim() === SEL.CHAT.resumeSendButtonText
                    );
                });
                if (!resumeBtn) {
                    this.log('无法发送简历');
                    return false;
                }
                if (resumeBtn.classList.contains('unable')) {
                    this.log('对方未回复，您无权发送简历');
                    return false;
                }
                await this.simulateClick(resumeBtn);
                await this.delay(250);

                const confirmBtn = await this.waitForElement(SEL.CHAT.resumeSendConfirm);
                if (!confirmBtn) {
                    this.log('未找到发送按钮');
                    return false;
                }
                await this.simulateClick(confirmBtn);
                return true;
            } catch (error) {
                this.log(`处理出错: ${error.message}`);
                return false;
            }
        },

        async simulateClick(element) {
            if (!element) return;
            const rect = element.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const dispatchMouseEvent = (type, options = {}) => {
                const event = new MouseEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    view: document.defaultView,
                    clientX: x,
                    clientY: y,
                    ...options
                });
                element.dispatchEvent(event);
            };
            dispatchMouseEvent('mouseover');
            await this.delay(30);
            dispatchMouseEvent('mousemove');
            await this.delay(30);
            dispatchMouseEvent('mousedown', { button: 0 });
            await this.delay(30);
            dispatchMouseEvent('mouseup', { button: 0 });
            await this.delay(30);
            dispatchMouseEvent('click', { button: 0 });
        },

        async waitForElement(selectorOrFunction, timeout = 5000) {
            return new Promise((resolve) => {
                let element;
                if (typeof selectorOrFunction === 'function') {
                    element = selectorOrFunction();
                } else {
                    element = document.querySelector(selectorOrFunction);
                }
                if (element) return resolve(element);

                const timeoutId = setTimeout(() => {
                    observer.disconnect();
                    resolve(null);
                }, timeout);

                const observer = new MutationObserver(() => {
                    if (typeof selectorOrFunction === 'function') {
                        element = selectorOrFunction();
                    } else {
                        element = document.querySelector(selectorOrFunction);
                    }
                    if (element) {
                        clearTimeout(timeoutId);
                        observer.disconnect();
                        resolve(element);
                    }
                });
                observer.observe(document.body, { childList: true, subtree: true });
            });
        },

        async delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        },

        resetCycle() {
            // 注意：必须先把计数读出来再停止，否则 toggleProcess() 会清零 currentIndex，
            // 导致"本次共沟通 0 个岗位"的错误日志（原 bug）。
            const doneCount = state.currentIndex;
            __BH__.toggleProcess();
            this.log(`🎉 所有符合条件的岗位沟通完成，本轮实际沟通 ${doneCount} 个，恭喜你即将找到理想工作！`);
        },

        log(message) {
            const logEntry = `[${new Date().toLocaleTimeString()}] ${message}`;
            const logPanel = document.querySelector('#pro-log');
            if (logPanel) {
                const logItem = document.createElement('div');
                logItem.className = 'log-item';
                logItem.style.cssText = 'margin-bottom: 4px; line-height: 1.5;';
                logItem.textContent = logEntry;
                logPanel.appendChild(logItem);
                logPanel.scrollTop = logPanel.scrollHeight;
            }
        }
    };

    __BH__.Core = Core;
})();
