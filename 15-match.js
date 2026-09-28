// BOSS海投助手 · JD 解码与匹配引擎
//
// 职责划分（重要）：
//   本模块 = **算法与判定逻辑**，纯函数为主，可独立测试、不依赖网络。
//   AI 调用放在 20-core.js —— 因为要复用它已有的 _chatCompletion / 额度控制。
//
// 匹配度算法来源：offer-toolkit-skill/job-description-skill/frameworks/match-rubric.md
//   总分 = 0.6 × MustHave + 0.2 × NiceToHave + 0.2 × HiddenSignalFit
//   单条三档：完全命中 1.0 / 部分命中 0.5 / 未命中 0.0
//   特殊规则：一条 Must Have 未命中 → 总分上限 75%；两条以上 → 上限 55%
//   输出规则：**给区间不给单点**（±5-8 个百分点），因为 Must Have 的判断本身有主观成分
//
// 隐形坑词典来源：同一 skill 的 decode-patterns.md「国内 JD 词典补充」一节。
(function () {
    'use strict';

    const CONFIG = __BH__.CONFIG;
    const state = __BH__.state;

    // ══════════════════════════════════════════════════════════════════
    //  一 · 薪资解析
    // ══════════════════════════════════════════════════════════════════

    /**
     * 从薪资文本抽出台价区间。
     *
     * 求职者的规则是「看**上限**」：上限够 7K 就算有机会（如"5-8K"算够）。
     * 所以解析必须给出 ceil，不能只给一个数。
     *
     * 支持格式：
     *   "8-12K" / "8-12k" / "8~12K" / "8K-12K" / "1.5-2万" / "8千-1.2万"
     *   "面议" / "底薪4K+提成" / "200-300/天"  → 返回 kind 标记，由上层决定
     */
    function parseSalary(text) {
        const raw = String(text || '').trim();
        const out = { raw, min: null, max: null, unit: 'K', kind: 'unknown' };
        if (!raw) return out;

        // 明确无法判断的一律标 ambiguous，交给上层归入「待确认」
        if (/面议|详谈|待遇从优/.test(raw)) { out.kind = 'negotiable'; return out; }

        const num = (s) => {
            const n = parseFloat(String(s).replace(/[^\d.]/g, ''));
            return Number.isNaN(n) ? null : n;
        };
        // 统一换算成"千元/月"
        const toK = (v, unit) => {
            if (v === null) return null;
            if (unit === '万') return v * 10;
            if (unit === '元' || unit === '千元以下') return v / 1000;
            return v;   // K
        };

        // ⚠️ 日薪/时薪必须**最先**识别。
        // 原实现让它走到了区间匹配，"200-300/天" 被解析成 min=200 max=300（当成 K），
        // 于是判定"上限 300K ≥ 7K"直接放行 —— 日薪被误当月薪，是真实 bug。
        if (/[\/每]\s*(天|日|小时|时|周)/.test(raw)) {
            const mm = raw.match(/(\d+(?:\.\d+)?)/);
            out.min = mm ? num(mm[1]) : null;
            out.max = out.min;
            out.kind = 'daily';
            return out;
        }

        // 形如 8-12K / 8K-12K / 1.5-2万
        let m = raw.match(/(\d+(?:\.\d+)?)\s*[kK千]?\s*[-~到至]\s*(\d+(?:\.\d+)?)\s*([kK千万]?)/);
        if (m) {
            const unit = m[3] || (/万/.test(raw) ? '万' : 'K');
            let a = toK(num(m[1]), unit), b = toK(num(m[2]), unit);
            if (/万/.test(raw) && !/k|K/.test(m[2])) { a = num(m[1]) * 10; b = num(m[2]) * 10; }
            out.min = Math.min(a, b); out.max = Math.max(a, b);
            out.unit = 'K'; out.kind = 'range';
            return out;
        }

        // 形如 8K 以上 / 8K 起
        m = raw.match(/(\d+(?:\.\d+)?)\s*([kK千万]?)\s*(以上|起|\+)/);
        if (m) {
            const unit = m[2] || (/万/.test(raw) ? '万' : 'K');
            const v = toK(num(m[1]), unit);
            out.min = v; out.max = null; out.kind = 'floor';
            return out;
        }

        // 单一数值
        m = raw.match(/(\d+(?:\.\d+)?)\s*([kK千万]?)/);
        if (m) {
            const unit = m[2] || (/万/.test(raw) ? '万' : 'K');
            const v = toK(num(m[1]), unit);
            // 日薪/时薪：与月薪不可比，标记出来
            if (/[\/每]\s*(天|日|小时|时)/.test(raw)) {
                out.min = v; out.max = v; out.kind = 'daily';
                return out;
            }
            out.min = v; out.max = v; out.kind = 'single';
            return out;
        }

        return out;
    }

    /**
     * 薪资是否满足硬条件。
     * 规则：看**上限**；上限未知时用下限；两者都没有 → 判为"需人工判断"。
     * @returns {{pass:boolean, reason:string, needsHuman:boolean}}
     */
    function checkSalaryHard(salaryText, ceilMin) {
        const s = parseSalary(salaryText);
        const limit = typeof ceilMin === 'number' ? ceilMin : CONFIG.MATCH.HARD.SALARY_CEIL_MIN;

        if (s.kind === 'unknown' || s.kind === 'negotiable') {
            return { pass: false, needsHuman: true, reason: `薪资「${s.raw || '未写'}」无法判断，需人工确认` };
        }
        if (s.kind === 'daily') {
            return { pass: false, needsHuman: true, reason: `薪资「${s.raw}」为日薪/时薪，与月薪不可比` };
        }
        const effective = s.max !== null ? s.max : s.min;
        if (effective === null) {
            return { pass: false, needsHuman: true, reason: `薪资「${s.raw}」解析不出数字` };
        }
        const pass = effective >= limit;
        return {
            pass,
            needsHuman: false,
            reason: pass
                ? `薪资上限 ${effective}K ≥ ${limit}K`
                : `薪资上限 ${effective}K < ${limit}K`,
        };
    }

    // ══════════════════════════════════════════════════════════════════
    //  二 · 硬条件检查（不花 AI 的钱，先卡掉）
    // ══════════════════════════════════════════════════════════════════

    /**
     * 检查硬条件。返回命中的排除原因列表。
     * 这些是求职者定的规则，AI 不得越过。
     *
     * @param {object} job  {title, companyName, salary, location, jdText}
     * @returns {{pass:boolean, hits:Array<{kind:string, detail:string}>}}
     */
    function checkHardConditions(job) {
        const H = CONFIG.MATCH.HARD;
        const hits = [];
        const title = String(job.title || '');
        const company = String(job.companyName || '');
        const salary = String(job.salary || '');
        const location = String(job.location || '');
        const jd = String(job.jdText || '');
        const all = `${title} ${company} ${jd}`;

        // 1. 地点（没写地点就不卡 —— 列表页经常抓不到，不能因此误杀）
        if (location && H.LOCATION && !location.includes(H.LOCATION)) {
            hits.push({ kind: 'location', detail: `地点「${location}」不是${H.LOCATION}` });
        }

        // 2. 薪资（看上限）
        const sal = checkSalaryHard(salary, H.SALARY_CEIL_MIN);
        if (!sal.pass) {
            hits.push({ kind: 'salary', detail: sal.reason, needsHuman: sal.needsHuman });
        }

        // 3. 排除岗位类型（只在**标题**里匹配，避免 JD 正文顺带提到就误杀）
        for (const kw of H.EXCLUDE_TITLE) {
            if (title.includes(kw)) {
                hits.push({ kind: 'title', detail: `岗位名含「${kw}」` });
            }
        }

        // 4. 明确排除的工作制 / 公司形式
        //    「外包」单独处理：大厂外包可投（降权），小公司外包排除。
        //    工具读不出公司规模，所以这里只标记，不直接排除 —— 交给上层降权。
        const excludeText = H.EXCLUDE_TEXT.filter((k) => k !== '外包');
        for (const kw of excludeText) {
            if (kw === '单休') {
                // 避开"非单休""双休"的误杀
                const idx = all.indexOf('单休');
                if (idx > -1) {
                    const before = all.slice(Math.max(0, idx - 3), idx);
                    if (!before.includes('非') && !before.includes('不') && !before.includes('双')) {
                        hits.push({ kind: 'text', detail: '工作制为单休' });
                    }
                }
            } else if (all.includes(kw)) {
                hits.push({ kind: 'text', detail: `含「${kw}」` });
            }
        }

        return { pass: hits.length === 0, hits };
    }

    /**
     * 是否属于销售 / BD 类岗位。
     * 销售类要额外卡「标价 ≥12K + JD 明写无责底薪 ≥6K」两道门槛。
     */
    function isSalesRole(job) {
        const text = `${job.title || ''} ${job.jdText || ''}`;
        return CONFIG.MATCH.SALES.KEYWORDS.some((k) => text.includes(k));
    }

    /**
     * 销售岗的额外门槛检查。
     * @returns {{pass:boolean, reason:string, needsHuman:boolean}}
     */
    function checkSalesThreshold(job) {
        const S = CONFIG.MATCH.SALES;
        const jd = String(job.jdText || '');
        const salary = String(job.salary || '');

        // ① 标价上限 ≥ 12K
        const sal = checkSalaryHard(salary, S.SALARY_CEIL_MIN);
        if (!sal.pass) {
            return { pass: false, needsHuman: sal.needsHuman, reason: `销售岗要求标价上限≥${S.SALARY_CEIL_MIN}K：${sal.reason}` };
        }

        // ② JD 必须明写「无责底薪 ≥ 6K」
        const baseHit = S.BASE_SALARY_PATTERNS.find((p) => jd.includes(p));
        if (!baseHit) {
            return { pass: false, needsHuman: false, reason: `销售岗未明写「无责底薪」（同类岗位不写往往意味着靠提成）` };
        }
        // 抽出无责底薪的数字
        const re = new RegExp(`(?:${S.BASE_SALARY_PATTERNS.join('|')})[^\\d]{0,6}(\\d+(?:\\.\\d+)?)\\s*[kK千万]?`);
        const m = jd.match(re);
        if (m) {
            let v = parseFloat(m[1]);
            if (/万/.test(m[0])) v *= 10;
            else if (/元/.test(m[0]) && v >= 1000) v /= 1000;
            if (v < S.BASE_SALARY_MIN) {
                return { pass: false, needsHuman: false, reason: `无责底薪 ${v}K < ${S.BASE_SALARY_MIN}K` };
            }
            return { pass: true, needsHuman: false, reason: `无责底薪 ${v}K ≥ ${S.BASE_SALARY_MIN}K` };
        }
        // 写了无责底薪但抽不出数字 → 需人工看
        return { pass: false, needsHuman: true, reason: `写了「${baseHit}」但抽不出数字，需人工确认` };
    }

    // ══════════════════════════════════════════════════════════════════
    //  三 · 隐形坑识别（硬条件抓不到的东西）
    // ══════════════════════════════════════════════════════════════════

    /**
     * 扫国内 JD 固定话术，识别隐性成本。
     * @returns {Array<{pattern:string, meaning:string}>}
     */
    function detectRedFlags(text) {
        const s = String(text || '');
        if (!s) return [];
        return CONFIG.JD_RED_FLAGS
            .filter((r) => r.pattern.test(s))
            .map((r) => ({ pattern: String(r.pattern).replace(/[\/\\^$*+?.()|[\]{}]/g, m => m).slice(0, 40), meaning: r.meaning }));
    }

    // ══════════════════════════════════════════════════════════════════
    //  四 · 匹配度计算（按 match-rubric 规范）
    // ══════════════════════════════════════════════════════════════════

    /** 单条命中分归一化：AI 可能返回 1 / 0.5 / 0、"full"/"partial"/"miss"、"命中"/"部分"/"未命中" */
    function normalizeHit(v) {
        if (typeof v === 'number') {
            if (v >= 0.9) return 1;
            if (v >= 0.4) return 0.5;
            return 0;
        }
        const s = String(v || '').toLowerCase();
        if (/^(full|1|yes|true|完全|命中|完全命中)$/.test(s)) return 1;
        if (/^(partial|0\.5|部分|相邻|部分命中)$/.test(s)) return 0.5;
        if (/^(miss|none|0|no|false|未命中|无)$/.test(s)) return 0;
        // 含中文关键词兜底
        if (s.includes('完全') || s.includes('命中') && !s.includes('未')) return 1;
        if (s.includes('部分') || s.includes('相邻')) return 0.5;
        return 0;
    }

    /**
     * 按规范算匹配度。
     *
     * 总分 = 0.6×MustHave + 0.2×NiceToHave + 0.2×HiddenSignalFit
     * 特殊规则：
     *   - 一条 Must Have 未命中 → 总分上限 75%
     *   - 两条及以上未命中   → 总分上限 55%
     *   - 门槛型未命中       → 直接压到 25-35%
     * 输出：区间（±6 个百分点），并给定性档。
     *
     * @param {object} judged AI 返回的结构化判断
     *   { mustHave:[{item,hit}], niceToHave:[{item,hit}],
     *     hiddenSignals:[{signal,fit}], gateMiss:boolean }
     * @returns {object} { lo, hi, tier, tierLabel, mustHaveScore, ... , caps:[] }
     */
    function computeMatchScore(judged) {
        const j = judged || {};
        const must = Array.isArray(j.mustHave) ? j.mustHave : [];
        const nice = Array.isArray(j.niceToHave) ? j.niceToHave : [];
        const hidden = Array.isArray(j.hiddenSignals) ? j.hiddenSignals : [];

        const avg = (arr, pick) => {
            if (!arr.length) return null;   // 无此项时不能用 0 充数
            const sum = arr.reduce((a, x) => a + normalizeHit(pick(x)), 0);
            return sum / arr.length;
        };

        const mustScore = avg(must, (x) => x.hit);
        const niceScore = avg(nice, (x) => x.hit);
        const hiddenScore = avg(hidden, (x) => x.fit);

        // 缺项时的权重再分配：只对存在的项按比例归一
        // （否则一个没有 Nice to Have 的 JD 会被无端扣 20 分）
        const parts = [];
        if (mustScore !== null) parts.push({ w: 0.6, v: mustScore });
        if (niceScore !== null) parts.push({ w: 0.2, v: niceScore });
        if (hiddenScore !== null) parts.push({ w: 0.2, v: hiddenScore });
        if (!parts.length) {
            return { lo: 0, hi: 0, tier: 'none', tierLabel: '无法判断', caps: ['AI 未给出可用的判断项'] };
        }
        const wSum = parts.reduce((a, p) => a + p.w, 0);
        const raw = parts.reduce((a, p) => a + (p.w / wSum) * p.v, 0);

        // ---- 特殊规则（封顶）----
        const caps = [];
        let score = raw;
        const mustMiss = must.filter((x) => normalizeHit(x.hit) === 0).length;

        if (j.gateMiss) {
            // 门槛型未命中（如"必须有某证书/某行业经验"）
            score = Math.min(score, 0.35);
            caps.push('门槛型要求在简历中无证据 → 封顶 35%');
        } else if (mustMiss >= 2) {
            score = Math.min(score, 0.55);
            caps.push(`${mustMiss} 条 Must Have 未命中 → 封顶 55%`);
        } else if (mustMiss === 1) {
            score = Math.min(score, 0.75);
            caps.push('1 条 Must Have 未命中 → 封顶 75%');
        }

        const pct = Math.round(score * 100);
        // 规范要求给区间，不给单点
        const lo = Math.max(0, pct - 6);
        const hi = Math.min(100, pct + 6);

        // 定性档（规范里的五档）
        let tier, tierLabel;
        if (pct >= 85) { tier = 'direct'; tierLabel = '直接对口型'; }
        else if (pct >= 70) { tier = 'strong'; tierLabel = '强匹配'; }
        else if (pct >= 55) { tier = 'medium'; tierLabel = '中等匹配'; }
        else if (pct >= 40) { tier = 'weak'; tierLabel = '弱匹配'; }
        else { tier = 'none'; tierLabel = '不匹配'; }

        return {
            lo, hi, pct, tier, tierLabel, caps,
            mustHaveScore: mustScore, niceToHaveScore: niceScore, hiddenSignalFit: hiddenScore,
            mustMiss,
        };
    }

    // ══════════════════════════════════════════════════════════════════
    //  五 · 综合决策
    // ══════════════════════════════════════════════════════════════════

    /**
     * 把「硬条件 + 销售门槛 + 匹配度」合成一个投递决策。
     * 顺序即优先级：硬条件最先（不花 AI 的钱），销售门槛次之，匹配度最后。
     *
     * @returns {{action:'apply'|'pending'|'skip', reason:string, detail:object}}
     *   apply   → 自动投
     *   pending → 进待确认，等用户勾
     *   skip    → 丢弃
     */
    function decide(job, matchResult) {
        // ① 硬条件
        const hard = checkHardConditions(job);
        if (!hard.pass) {
            // 其中「薪资无法判断」这类不是真的不合规，而是信息不足 → 归待确认
            const needsHuman = hard.hits.some((h) => h.needsHuman);
            return {
                action: needsHuman ? 'pending' : 'skip',
                reason: hard.hits.map((h) => h.detail).join('；'),
                detail: { stage: 'hard', hits: hard.hits },
            };
        }

        // ② 销售岗双门槛
        if (isSalesRole(job)) {
            const sales = checkSalesThreshold(job);
            if (!sales.pass) {
                return {
                    action: sales.needsHuman ? 'pending' : 'pending',
                    reason: sales.reason,
                    detail: { stage: 'sales', isSales: true },
                };
            }
        }

        // ③ 匹配度（取区间**下限**做决策，保守）
        if (!matchResult) {
            return { action: 'pending', reason: '未取得匹配度判断', detail: { stage: 'match' } };
        }
        const lo = matchResult.lo;
        if (lo >= CONFIG.MATCH.AUTO_APPLY_MIN) {
            return {
                action: 'apply',
                reason: `匹配度 ${matchResult.lo}-${matchResult.hi}%（${matchResult.tierLabel}），下限 ≥ ${CONFIG.MATCH.AUTO_APPLY_MIN}`,
                detail: { stage: 'match', match: matchResult },
            };
        }
        if (lo >= CONFIG.MATCH.PREFILTER_MIN) {
            return {
                action: 'pending',
                reason: `匹配度 ${matchResult.lo}-${matchResult.hi}%（${matchResult.tierLabel}），低于自动投递线 ${CONFIG.MATCH.AUTO_APPLY_MIN}`,
                detail: { stage: 'match', match: matchResult },
            };
        }
        return {
            action: 'skip',
            reason: `匹配度 ${matchResult.lo}-${matchResult.hi}%（${matchResult.tierLabel}），低于淘汰线 ${CONFIG.MATCH.PREFILTER_MIN}`,
            detail: { stage: 'match', match: matchResult },
        };
    }

    // ══════════════════════════════════════════════════════════════════
    //  六 · 候选快照（喂给 AI 用）
    // ══════════════════════════════════════════════════════════════════

    /**
     * 组装"求职者事实"，供 AI 判断匹配度与写招呼语时取材。
     *
     * ⚠️ 只包含**已验证的事实**（来自简历与用户确认），
     *    不包含任何推测。AI 只能从这里取材，不得自行补充。
     */
    function getCandidateFacts() {
        const r = state.resume || {};
        return {
            name: r.name || '唐杨滨',
            age: 20,
            location: '深圳',
            education: '非全日制本科在读（深圳开放大学，2026-2029，边工作边读，不影响全职到岗）',
            expectedSalary: '8-12K',
            // 底线只在被压价时才亮，不写进喂给 AI 的常规事实里
            workYears: '约 3 年 8 个月（2022.12–2026.08 同一家公司）',
            experiences: [
                {
                    company: '凯烽达科技有限公司', role: '仓库管理员', period: '2022.12–2026.08（3 年 8 个月）',
                    industry: '电子/半导体/集成电路',
                    points: [
                        '独立负责 1200+ SKU 电子元器件全流程运营（收货→质检→入库→拣货→发货），日均处理 50+ 订单，月均货物吞吐约 150 万元',
                        '日常操作 ERP/WMS 完成数据录入、盘点与异常处理；系统报错或数据不匹配时主动排查修正，理解 B 端数据结构与业务流转逻辑',
                        '担任仓储与采购、销售、物流三方日常对接人，处理订单异常与加急发货，同时对齐三方诉求并推动落地',
                        '多次在拣货环节发现单据录入错误（型号混淆、数量不符），主动拦截并同步采购、销售纠正，避免错发漏发',
                        '发现库存盘点流程存在重复录入环节，用 Excel 高级函数 + 数据透视表重构报表，月度盘点整理时间缩短约 30%',
                        '主动尝试用 ChatGPT / DeepSeek 辅助撰写库存分析文案与优化拣货路径描述，验证 AI 工具在业务场景的落地可行性',
                    ],
                },
                {
                    company: '某日化消费品公司（已注销）', role: '地推专员', period: '2022.06–2022.11',
                    industry: '日化',
                    points: [
                        '负责日化清洁产品线下地推，社区驻点与陌生拜访，日均触达 100+ 人',
                        '针对家庭清洁痛点讲解产品卖点，日均获客 10-25 人，转化率约 10%-25%',
                        '累计覆盖深圳 10+ 社区及商圈，独立完成从触达、讲解、成交到跟进的完整销售闭环',
                        '在高拒绝率的一线场景中练出抗压能力，能快速识别不同客户的真实需求并即时调整话术',
                    ],
                },
            ],
            projects: [
                {
                    name: '会员制兴趣社群（独立创业项目）', period: '2023',
                    points: [
                        '从零搭建深圳地区会员制兴趣社群，独立招募付费会员 200+ 人（会费 200 元/人）',
                        '负责招募拉新→会员分层→线下活动组织→付费匹配服务转化全流程',
                        '单月社群营收约 6 万元；建立会员跟进机制，完成从触达到付费的完整服务闭环',
                        '因评估该领域存在合规风险，主动终止项目，未产生纠纷与遗留问题',
                    ],
                },
                {
                    name: '微信 AI 顾问（AstrBot + DeepSeek）', period: '2026.08',
                    points: [
                        '独立搭建微信 AI 机器人并部署上线，24 小时稳定运行',
                        '开发核心算法插件与文本净化插件（对 LLM 回复做确定性后处理，过滤模板腔与客服腔）',
                        '项目配 103 个单元测试、482 处断言',
                        '根据真实用户反馈迭代 12 轮人设与回答策略，从"太机械像客服"调整到自然对话风格',
                    ],
                    source: 'https://github.com/dwjg0517/xiao-rui-astrbot',
                },
                {
                    name: '观复 — 原生 JS Web 应用', period: '2026.07–至今',
                    points: [
                        '独立开发并部署上线，纯原生 HTML/CSS/JavaScript 实现、未使用框架，可完全离线运行',
                        '手写 SSE 流式解析实现逐字输出，不依赖任何 SDK',
                        '统一适配 12 家 AI 服务商（OpenAI / Anthropic / DeepSeek / 智谱 / 通义 / Groq / OpenRouter 等）',
                        '独立实现核心算法（农历转换、节气推算、太阳时校正）并用历史数据交叉验证准确性',
                    ],
                    source: 'https://github.com/dwjg0517/guanfu-workbench',
                },
                {
                    name: 'BOSS 海投助手 — 浏览器自动化扩展', period: '2026',
                    points: [
                        '将 2500 行单体脚本按职责解耦为 10 个模块，建立选择器单一来源与单向依赖链',
                        '设计 11 组自动化验证套件（500+ 断言），覆盖投递链路、AI 请求、存储容错与 DOM 结构',
                        '引入变异测试：主动注入 48 个缺陷逐一验证测试可捕获，据此定位并修复 4 处测试盲区',
                        '解决三类线上缺陷：并发去重误判、正则构造导致的解析崩溃、模型输出截断引发的解析失败',
                    ],
                    source: 'https://github.com/dwjg0517/boss-helper',
                },
            ],
            skills: {
                communication: ['陌生拜访', '需求挖掘', '异议处理', '客户跟进', '跨部门协调', '高拒绝率场景下的持续输出'],
                operations: ['用户拉新', '社群运营', '活动组织', '付费转化', '会员分层'],
                technical: ['Python', 'JavaScript', 'DeepSeek API', 'Prompt 工程', 'SSE 流式传输', '正则 NLP'],
                data: ['SQL', 'SQLite', 'Excel 数据透视表', 'ECharts'],
                systems: ['ERP/WMS 操作', 'B 端数据结构理解', '订单异常处理'],
                tools: ['Git', 'Node.js', 'PowerShell'],
                aiCollab: '能拆解需求并指挥 AI 完成开发，独立交付 4 个可运行的上线产品',
            },
            // 红线：绝不许编造的东西（写进提示词，让 AI 明确知道边界）
            mustNotFabricate: [
                '导师/带领团队/主导项目（简历写的是"独立开发"）',
                '实施经验、系统上线经验、培训客户经验（没有）',
                '精通某技术（只说会用于开发可运行应用）',
                '任何简历中不存在的数字、学历、证书、公司名',
                '术数/命理/八字/占卜类表述（统一说"算法引擎/推演模式"）',
            ],
        };
    }

    // ══════════════════════════════════════════════════════════════════

    __BH__.Matcher = {
        parseSalary,
        checkSalaryHard,
        checkHardConditions,
        isSalesRole,
        checkSalesThreshold,
        detectRedFlags,
        computeMatchScore,
        normalizeHit,
        decide,
        getCandidateFacts,
    };
})();
