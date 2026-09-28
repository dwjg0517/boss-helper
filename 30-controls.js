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

    function toggleProcess() {
        state.isRunning = !state.isRunning;
        if (state.isRunning) {
            // 保存筛选设置
            state.filterKeyword = elements.filterInput.value.trim();
            state.locationKeyword = elements.locationInput.value.trim();
            FilterUtils.saveFilters();

            elements.controlBtn.textContent = '停止海投';
            elements.controlBtn.style.background = `linear-gradient(45deg, ${CONFIG.COLORS.SECONDARY}, #f44336)`;
            const startTime = new Date();
            Core.log(`🚀 开始自动海投，时间：${startTime.toLocaleTimeString()}`);
            Core.startProcessing();
        } else {
            elements.controlBtn.textContent = '启动海投';
            elements.controlBtn.style.background = `linear-gradient(45deg, ${CONFIG.COLORS.PRIMARY}, #4db6ac)`;
            state.isRunning = false;
            // 取消可能仍在进行的滚动递归，避免"停止"后残留循环继续跑
            if (typeof Core.stopAutoScroll === 'function') Core.stopAutoScroll();
            const stopTime = new Date();
            Core.log(`⏹ 停止自动海投，时间：${stopTime.toLocaleTimeString()}`);
            Core.log(`📊 本次共沟通 ${state.currentIndex} 个岗位`);
            state.currentIndex = 0;
        }
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

    __BH__.toggleProcess = toggleProcess;
    __BH__.toggleChatProcess = toggleChatProcess;
})();
