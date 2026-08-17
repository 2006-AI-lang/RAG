/**
 * FitQA - 运动健身智能问答系统 主逻辑
 * 连接 FastAPI 后端（ngrok 公网穿透）
 */

// ==================== API 配置 ====================
// 使用相对路径，确保通过任何方式访问（localhost/127.0.0.1/LAN IP/ngrok）都能正常请求
const API_BASE_URL = '';

// ==================== 全局状态 ====================
const STATE = {
    currentTab: 'chat',
    sessions: [],
    currentSessionId: null,
    history: [],
    knowledgeCache: null,
    categoriesCache: null,
    knowledgeSort: 'index',
    backendHealthy: false,
};

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
    initNavigation();
    initChat();
    initCompare();
    initSettings();
    initImport();
    initEntryModal();
    await checkBackendHealth();
    if (STATE.backendHealthy) {
        await Promise.all([initKnowledge(), initHistory()]);
    } else {
        initKnowledgeFallback();
        initHistoryFallback();
    }
    initSuggestQuestions();
});

// ==================== 后端健康检查 ====================
async function checkBackendHealth() {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.getElementById('apiStatusText');
    try {
        const resp = await fetch(`${API_BASE_URL}/health`);
        if (resp.ok) {
            const data = await resp.json();
            STATE.backendHealthy = true;
            STATE.healthData = data;
            statusDot.className = 'status-dot online';
            const activeModel = data.active_model;
            statusText.textContent = data.mock_mode
                ? '离线'
                : (activeModel && activeModel.name ? activeModel.name : '大模型模式');
            console.log('[FitQA] Backend connected:', data);
            return;
        }
        console.warn('[FitQA] Health check failed:', resp.status, resp.statusText);
    } catch (e) {
        console.warn('[FitQA] Backend unreachable:', e.message, 'URL:', `${API_BASE_URL}/health`);
    }
    STATE.backendHealthy = false;
    statusDot.className = 'status-dot offline';
    statusText.textContent = '离线';
}

// ==================== 网络请求封装 ====================
async function apiGet(path) {
    try {
        const resp = await fetch(`${API_BASE_URL}${path}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
    } catch (e) {
        showToast(`网络请求失败: ${e.message}`, 'error');
        throw e;
    }
}

async function apiPost(path, body) {
    try {
        const resp = await fetch(`${API_BASE_URL}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            throw new Error(`HTTP ${resp.status} - ${text.substring(0, 200)}`);
        }
        return await resp.json();
    } catch (e) {
        showToast(`网络请求失败: ${e.message}`, 'error');
        throw e;
    }
}

async function apiDelete(path, query) {
    try {
        let url = `${API_BASE_URL}${path}`;
        if (query) {
            const qs = Object.entries(query)
                .filter(([, v]) => v !== undefined && v !== null)
                .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(Array.isArray(v) ? v.join(',') : v)}`)
                .join('&');
            if (qs) url += `?${qs}`;
        }
        const resp = await fetch(url, { method: 'DELETE' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
    } catch (e) {
        showToast(`网络请求失败: ${e.message}`, 'error');
        throw e;
    }
}

// ==================== 导航切换 ====================
function initNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn');
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            switchTab(tab);
        });
    });
}

function switchTab(tab) {
    STATE.currentTab = tab;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.nav-btn[data-tab="${tab}"]`).classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
}

// ==================== Toast 提示 ====================
function showToast(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ==================== 聊天功能 ====================
function initChat() {
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('btnSend');
    const newChatBtn = document.getElementById('btnNewChat');

    if (STATE.sessions.length === 0) {
        createSession();
    } else {
        STATE.currentSessionId = STATE.sessions[0].id;
    }
    renderSessionList();

    sendBtn.addEventListener('click', handleSendMessage);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });
    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
    newChatBtn.addEventListener('click', () => createSession());
}

function createSession() {
    const session = {
        id: Date.now().toString(),
        title: '新对话',
        messages: [],
        createdAt: new Date().toISOString(),
    };
    STATE.sessions.unshift(session);
    STATE.currentSessionId = session.id;
    renderSessionList();
    renderMessages();
}

function getCurrentSession() {
    return STATE.sessions.find(s => s.id === STATE.currentSessionId);
}

function renderSessionList() {
    const list = document.getElementById('chatSessionList');
    if (!list) return;
    list.innerHTML = STATE.sessions.map(s => `
        <div class="session-item ${s.id === STATE.currentSessionId ? 'active' : ''}" data-id="${s.id}">
            <span class="session-title">${escapeHtml(s.title)}</span>
            <span class="session-delete" data-action="delete" title="删除对话">
                <svg width="12" height="12" viewBox="0 0 12 12"><line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" stroke-width="1.5"/></svg>
            </span>
        </div>
    `).join('');

    list.querySelectorAll('.session-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('[data-action="delete"]')) {
                deleteSession(item.dataset.id);
                return;
            }
            STATE.currentSessionId = item.dataset.id;
            renderSessionList();
            renderMessages();
        });
    });
}

function deleteSession(id) {
    STATE.sessions = STATE.sessions.filter(s => s.id !== id);
    if (STATE.currentSessionId === id) {
        STATE.currentSessionId = STATE.sessions.length > 0 ? STATE.sessions[0].id : null;
        if (!STATE.currentSessionId) createSession();
    }
    renderSessionList();
    renderMessages();
    showToast('对话已删除', 'info');
}

function renderMessages() {
    const container = document.getElementById('chatMessages');
    const session = getCurrentSession();

    if (!session || session.messages.length === 0) {
        container.innerHTML = `
            <div class="chat-welcome">
                <div class="welcome-icon">
                    <svg width="48" height="48" viewBox="0 0 32 32" fill="none">
                        <rect x="3" y="10" width="4" height="12" rx="1.5" stroke="#4A9E6B" stroke-width="2.5"/>
                        <rect x="9" y="7" width="4" height="18" rx="1.5" stroke="#4A9E6B" stroke-width="2.5"/>
                        <line x1="13" y1="16" x2="19" y2="16" stroke="#4A9E6B" stroke-width="2.5" stroke-linecap="round"/>
                        <rect x="19" y="7" width="4" height="18" rx="1.5" stroke="#4A9E6B" stroke-width="2.5"/>
                        <rect x="25" y="10" width="4" height="12" rx="1.5" stroke="#4A9E6B" stroke-width="2.5"/>
                    </svg>
                </div>
                <h2>欢迎使用 FitQA</h2>
                <p>我是你的智能健身教练助手，可以回答关于减脂、增肌、力量训练、运动损伤预防等问题。</p>
                <div class="suggest-questions">
                    <span>试试这些问题：</span>
                    <button class="suggest-btn" data-question="新手增肌训练一周几次比较合适？">新手增肌训练一周几次比较合适？</button>
                    <button class="suggest-btn" data-question="如何正确做杠铃深蹲？">如何正确做杠铃深蹲？</button>
                    <button class="suggest-btn" data-question="减脂期饮食应该怎么安排？">减脂期饮食应该怎么安排？</button>
                    <button class="suggest-btn" data-question="跑步膝盖疼是什么原因？">跑步膝盖疼是什么原因？</button>
                </div>
            </div>
        `;
        initSuggestQuestions();
        return;
    }

    container.innerHTML = session.messages.map(m => `
        <div class="message ${m.role}">
            <div class="message-avatar">${m.role === 'user' ? 'U' : 'AI'}</div>
            <div>
                <div class="message-bubble">${formatMessage(m.content, m.sources)}</div>
                <div class="message-time">${m.time}</div>
            </div>
        </div>
    `).join('');

    container.scrollTop = container.scrollHeight;
}

function formatMessage(content, sources) {
    let html = content.replace(/\n/g, '<br>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/【(.+?)】/g, '<strong>【$1】</strong>');

    if (sources && sources.length > 0) {
        html += '<br><span class="source-tag">参考来源：' +
            sources.map((s, i) => {
                const label = `【资料${i + 1}】${s.title}`;
                return s.url ? `<a href="${s.url}" target="_blank" rel="noopener">${label}</a>` : label;
            }).join('、') +
            '</span>';
    }

    if (content.includes('风险提示') || content.includes('免责') || content.includes('咨询医生')) {
        html += '<div class="risk-note">风险提示：本回答仅作为知识科普参考，不构成专业医疗建议。涉及伤病问题请咨询专业医生或教练。</div>';
    }

    return html;
}

function initSuggestQuestions() {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    container.removeEventListener('click', handleSuggestClick);
    container.addEventListener('click', handleSuggestClick);
}

function handleSuggestClick(e) {
    const btn = e.target.closest('.suggest-btn');
    if (!btn) return;
    const question = btn.dataset.question;
    document.getElementById('chatInput').value = question;
    handleSendMessage();
}

async function handleSendMessage() {
    const input = document.getElementById('chatInput');
    const question = input.value.trim();
    if (!question) return;

    const modeRadio = document.querySelector('input[name="searchMode"]:checked');
    const mode = modeRadio ? modeRadio.value : 'hybrid';

    if (!getCurrentSession()) createSession();

    const session = getCurrentSession();
    const userMsg = {
        role: 'user',
        content: question,
        time: formatTime(new Date()),
    };
    session.messages.push(userMsg);

    if (session.messages.length === 1 || session.title === '新对话') {
        session.title = question.length > 20 ? question.substring(0, 20) + '...' : question;
    }

    input.value = '';
    input.style.height = 'auto';
    renderSessionList();
    renderMessages();

    const container = document.getElementById('chatMessages');
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message assistant';
    typingDiv.innerHTML = `
        <div class="message-avatar">AI</div>
        <div class="message-bubble">
            <div class="typing-indicator">
                <span></span><span></span><span></span>
            </div>
        </div>
    `;
    container.appendChild(typingDiv);
    container.scrollTop = container.scrollHeight;

    let answer, sources;

    if (STATE.backendHealthy) {
        try {
            const data = await apiPost('/ask', { question, mode });
            answer = data.answer;
            sources = data.sources;
        } catch (e) {
            answer = `请求失败：${e.message}\n\n当前请求地址：${API_BASE_URL}/ask\n页面地址：${window.location.href}`;
            sources = [];
        }
    } else {
        answer = `后端服务不可用（健康检查未通过）。\n\n请确认后端已启动：python3 -m uvicorn main:app --host 0.0.0.0 --port 8000`;
        sources = [];
    }

    typingDiv.remove();

    const assistantMsg = {
        role: 'assistant',
        content: answer,
        sources: sources,
        time: formatTime(new Date()),
    };
    session.messages.push(assistantMsg);
    renderMessages();

    if (STATE.backendHealthy) {
        loadHistoryFromBackend();
    }
}

// ==================== 检索对比面板 ====================
function initCompare() {
    const btnCompare = document.getElementById('btnCompare');
    const input = document.getElementById('compareInput');

    btnCompare.addEventListener('click', () => handleCompare());
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleCompare();
    });

    input.value = '新手增肌训练一周几次比较合适？';
}

async function handleCompare() {
    const question = document.getElementById('compareInput').value.trim();
    if (!question) {
        showToast('请输入要对比的问题', 'error');
        return;
    }

    const container = document.getElementById('compareResults');

    if (!STATE.backendHealthy) {
        container.innerHTML = `<div class="history-empty"><p>后端服务不可用，无法进行检索对比。请确认后端已启动。</p></div>`;
        return;
    }

    container.innerHTML = `
        <div class="compare-column"><div class="compare-column-body" style="text-align:center;padding:40px;">BM25 检索中...</div></div>
        <div class="compare-column"><div class="compare-column-body" style="text-align:center;padding:40px;">向量检索中...</div></div>
    `;

    let bm25Result, vectorResult;
    try {
        [bm25Result, vectorResult] = await Promise.all([
            apiPost('/ask', { question, mode: 'bm25' }),
            apiPost('/ask', { question, mode: 'vector' }),
        ]);
    } catch (e) {
        container.innerHTML = `<div class="history-empty"><p>请求失败: ${e.message}</p></div>`;
        return;
    }

    container.innerHTML = `
        <div class="compare-column">
            <div class="compare-column-header">
                <svg width="18" height="18" viewBox="0 0 18 18"><rect x="2" y="2" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5" fill="none"/><line x1="6" y1="6" x2="12" y2="6" stroke="currentColor" stroke-width="1.5"/><line x1="6" y1="9" x2="12" y2="9" stroke="currentColor" stroke-width="1.5"/><line x1="6" y1="12" x2="10" y2="12" stroke="currentColor" stroke-width="1.5"/></svg>
                BM25 字面检索
                <span class="badge badge-bm25">对照组</span>
            </div>
            <div class="compare-column-body">
                <div class="compare-answer">
                    <div class="answer-label">生成结果</div>
                    ${escapeHtml(bm25Result.answer).replace(/\n/g, '<br>')}
                </div>
                <div class="compare-sources">
                    <div class="source-label">检索到的知识片段（Top ${bm25Result.sources.length}）</div>
                    ${bm25Result.sources.map(s => `
                        <div class="compare-source-item">
                            <span class="source-score">${typeof s.score === 'number' && s.score > 1 ? s.score.toFixed(1) : s.score.toFixed(2)}</span>
                            <div>
                                <strong>${s.url ? `<a href="${s.url}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a>` : escapeHtml(s.title)}</strong>
                                <div class="source-text">${escapeHtml(s.snippet)}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div class="compare-metric">
                    <span>命中数：<strong>${bm25Result.sources.length}</strong></span>
                    <span>方法：<strong>BM25 + jieba 分词</strong></span>
                </div>
            </div>
        </div>
        <div class="compare-column">
            <div class="compare-column-header">
                <svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="6" cy="7" r="1.2" fill="currentColor"/><circle cx="12" cy="7" r="1.2" fill="currentColor"/><circle cx="9" cy="11" r="1.2" fill="currentColor"/><line x1="6" y1="7" x2="12" y2="7" stroke="currentColor" stroke-width="1"/><line x1="6" y1="7" x2="9" y2="11" stroke="currentColor" stroke-width="1"/><line x1="12" y1="7" x2="9" y2="11" stroke="currentColor" stroke-width="1"/></svg>
                向量语义检索
                <span class="badge badge-vector">实验组</span>
            </div>
            <div class="compare-column-body">
                <div class="compare-answer">
                    <div class="answer-label">生成结果</div>
                    ${escapeHtml(vectorResult.answer).replace(/\n/g, '<br>')}
                </div>
                <div class="compare-sources">
                    <div class="source-label">检索到的知识片段（Top ${vectorResult.sources.length}）</div>
                    ${vectorResult.sources.map(s => `
                        <div class="compare-source-item">
                            <span class="source-score">${s.score.toFixed(2)}</span>
                            <div>
                                <strong>${s.url ? `<a href="${s.url}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a>` : escapeHtml(s.title)}</strong>
                                <div class="source-text">${escapeHtml(s.snippet)}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div class="compare-metric">
                    <span>命中数：<strong>${vectorResult.sources.length}</strong></span>
                    <span>方法：<strong>Embedding + FAISS 向量检索</strong></span>
                </div>
            </div>
        </div>
    `;
}

// ==================== 知识库浏览 ====================
async function initKnowledge() {
    if (!STATE.backendHealthy) return initKnowledgeFallback();

    try {
        const [items, categories] = await Promise.all([
            apiGet('/knowledge/list'),
            apiGet('/knowledge/categories'),
        ]);
        STATE.knowledgeCache = items;
        STATE.categoriesCache = categories;

        renderKnowledgeStats(items, categories);
        renderFilterTags(categories);
        renderKnowledgeList(items);

        const searchInput = document.getElementById('knowledgeSearch');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                const query = searchInput.value.trim().toLowerCase();
                const activeCat = document.querySelector('.filter-tag.active')?.dataset.cat || 'all';
                filterKnowledge(query, activeCat);
            });
        }

        const sortSelect = document.getElementById('knowledgeSort');
        if (sortSelect) {
            sortSelect.value = STATE.knowledgeSort || 'index';
            sortSelect.addEventListener('change', () => {
                STATE.knowledgeSort = sortSelect.value;
                const query = (document.getElementById('knowledgeSearch')?.value || '').trim().toLowerCase();
                const activeCat = document.querySelector('.filter-tag.active')?.dataset.cat || 'all';
                filterKnowledge(query, activeCat);
            });
        }
    } catch (e) {
        initKnowledgeFallback();
    }
}

function initKnowledgeFallback() {
    if (typeof KNOWLEDGE_BASE !== 'undefined') {
        STATE.knowledgeCache = KNOWLEDGE_BASE;
        STATE.categoriesCache = typeof CATEGORIES !== 'undefined'
            ? CATEGORIES.map(c => ({ category: c, count: KNOWLEDGE_BASE.filter(k => k.category === c).length }))
            : [];
        renderKnowledgeStats(STATE.knowledgeCache, STATE.categoriesCache);
        renderFilterTags(STATE.categoriesCache);
        renderKnowledgeList(STATE.knowledgeCache);
    }
}

function renderKnowledgeStats(items, categories) {
    const statTotal = document.getElementById('statTotal');
    const statCats = document.getElementById('statCats');
    if (statTotal) statTotal.textContent = items.length;
    if (statCats) statCats.textContent = categories.length;
}

function renderFilterTags(categories) {
    const container = document.getElementById('filterTags');
    if (!container) return;
    const allCats = ['all', ...categories.map(c => c.category)];
    container.innerHTML = allCats.map(cat => `
        <button class="filter-tag ${cat === 'all' ? 'active' : ''}" data-cat="${cat}">
            ${cat === 'all' ? '全部' : cat}
        </button>
    `).join('');

    container.querySelectorAll('.filter-tag').forEach(tag => {
        tag.addEventListener('click', () => {
            container.querySelectorAll('.filter-tag').forEach(t => t.classList.remove('active'));
            tag.classList.add('active');
            const query = document.getElementById('knowledgeSearch')?.value.trim().toLowerCase() || '';
            filterKnowledge(query, tag.dataset.cat);
        });
    });
}

function filterKnowledge(query, cat) {
    let filtered = STATE.knowledgeCache || [];
    if (cat && cat !== 'all') {
        filtered = filtered.filter(k => k.category === cat);
    }
    if (query) {
        filtered = filtered.filter(k =>
            k.title.toLowerCase().includes(query) ||
            k.content.toLowerCase().includes(query) ||
            (k.tags && k.tags.some(t => t.toLowerCase().includes(query)))
        );
    }
    renderKnowledgeList(filtered);
}

function renderKnowledgeList(items) {
    const container = document.getElementById('knowledgeList');
    if (!container) return;
    if (!items || items.length === 0) {
        container.innerHTML = '<div class="history-empty"><p>没有找到匹配的知识条目</p></div>';
        return;
    }
    items = sortKnowledgeItems(items);
    const isStatic = (id) => String(id).startsWith('KB');
    container.innerHTML = items.map(k => `
        <div class="knowledge-card" data-id="${escapeHtml(k.id)}">
            <div class="knowledge-card-check">
                <input type="checkbox" class="knowledge-check" data-id="${escapeHtml(k.id)}" ${isStatic(k.id) ? 'title="内置知识不可修改"' : ''}>
            </div>
            <div class="knowledge-card-actions">
                <button class="btn-card-action btn-card-edit" data-action="edit" data-id="${escapeHtml(k.id)}" title="编辑">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="btn-card-action btn-card-delete" data-action="delete" data-id="${escapeHtml(k.id)}" data-title="${escapeHtml(k.title)}" title="删除">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
            <div class="knowledge-card-header">
                <h3><span class="k-index">${escapeHtml(k.id)}</span>：${escapeHtml(k.title)}</h3>
                <span class="k-category">${escapeHtml(k.category)}</span>
            </div>
            <div class="k-content">${escapeHtml((k.content || '').substring(0, 200))}...</div>
            <div class="k-meta">
                <span>来源: ${k.url ? `<a href="${k.url}" target="_blank" rel="noopener">${escapeHtml(k.source || '')}</a>` : escapeHtml(k.source || '')}</span>
                ${k.tags ? `<span>标签: ${k.tags.map(t => '#' + t).join(' ')}</span>` : ''}
            </div>
            ${k.created_at ? `<span class="k-time">导入时间: ${escapeHtml(formatDateTime(k.created_at))}</span>` : ''}
        </div>
    `).join('');

    container.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openEditEntryModal(btn.dataset.id);
        });
    });

    container.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openDeleteConfirm(btn.dataset.id, btn.dataset.title);
        });
    });

    container.querySelectorAll('.knowledge-check').forEach(cb => {
        cb.addEventListener('change', updateKnowledgeBatchCount);
    });
}

function sortKnowledgeItems(items) {
    const sort = STATE.knowledgeSort || 'index';
    const arr = [...items];
    if (sort === 'category') {
        arr.sort((a, b) =>
            (a.category || '').localeCompare(b.category || '', 'zh') ||
            String(a.id).localeCompare(String(b.id), 'en', { numeric: true })
        );
    } else if (sort === 'time') {
        arr.sort((a, b) => {
            const ta = a.created_at || '';
            const tb = b.created_at || '';
            if (ta && tb) return tb.localeCompare(ta);
            if (ta) return -1;
            if (tb) return 1;
            return String(a.id).localeCompare(String(b.id), 'en', { numeric: true });
        });
    } else {
        arr.sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));
    }
    return arr;
}

// ==================== 问答历史 ====================
async function initHistory() {
    if (!STATE.backendHealthy) return initHistoryFallback();

    const clearBtn = document.getElementById('btnClearHistory');
    if (clearBtn) {
        clearBtn.addEventListener('click', async () => {
            try {
                await apiDelete('/history');
                STATE.history = [];
                renderHistoryList();
                showToast('问答历史已清空', 'info');
            } catch (e) {
                showToast('清空失败', 'error');
            }
        });
    }

    const btnBatchDeleteHistory = document.getElementById('btnBatchDeleteHistory');
    if (btnBatchDeleteHistory) {
        btnBatchDeleteHistory.addEventListener('click', enterHistoryBatchMode);
    }
    const btnConfirmBatchDeleteHistory = document.getElementById('btnConfirmBatchDeleteHistory');
    if (btnConfirmBatchDeleteHistory) {
        btnConfirmBatchDeleteHistory.addEventListener('click', executeBatchDeleteHistory);
    }
    const btnCancelHistoryBatch = document.getElementById('btnCancelHistoryBatch');
    if (btnCancelHistoryBatch) {
        btnCancelHistoryBatch.addEventListener('click', exitHistoryBatchMode);
    }
    const historyCheckAll = document.getElementById('historyCheckAll');
    if (historyCheckAll) {
        historyCheckAll.addEventListener('change', () => {
            document.querySelectorAll('.history-check').forEach(cb => {
                cb.checked = historyCheckAll.checked;
            });
            updateHistoryBatchCount();
        });
    }

    await loadHistoryFromBackend();
    renderHistoryList();
}

function initHistoryFallback() {
    const clearBtn = document.getElementById('btnClearHistory');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            STATE.history = [];
            localStorage.removeItem('fitqa_history');
            renderHistoryList();
            showToast('问答历史已清空（本地）', 'info');
        });
    }
    STATE.history = loadLocalHistory();
    renderHistoryList();
}

async function loadHistoryFromBackend() {
    try {
        const data = await apiGet('/history');
        STATE.history = data.map(r => ({
            id: r.id,
            question: r.question,
            answer: r.answer,
            mode: r.mode,
            sources: r.sources ? JSON.parse(r.sources) : [],
            time: r.created_at,
        }));
    } catch (e) {
        // 静默
    }
    renderHistoryList();
}

function renderHistoryList() {
    const container = document.getElementById('historyList');
    if (!container) return;

    if (!STATE.history || STATE.history.length === 0) {
        container.innerHTML = `
            <div class="history-empty">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                    <rect x="12" y="8" width="24" height="32" rx="3" stroke="#999" stroke-width="2"/>
                    <line x1="18" y1="16" x2="30" y2="16" stroke="#999" stroke-width="1.5"/>
                    <line x1="18" y1="22" x2="30" y2="22" stroke="#999" stroke-width="1.5"/>
                    <line x1="18" y1="28" x2="26" y2="28" stroke="#999" stroke-width="1.5"/>
                </svg>
                <p>暂无问答记录</p>
            </div>`;
        return;
    }

    container.innerHTML = STATE.history.map(h => {
        const time = new Date(h.time);
        const modeLabel = h.mode === 'hybrid' ? '混合检索' : h.mode === 'bm25' ? 'BM25' : '向量检索';
        return `
            <div class="history-item" data-id="${h.id}">
                <div class="history-item-check">
                    <input type="checkbox" class="history-check" data-id="${h.id}">
                </div>
                <div class="history-item-body">
                    <div class="hi-question">Q: ${escapeHtml(h.question)}</div>
                    <div class="hi-answer">A: ${escapeHtml((h.answer || '').substring(0, 150))}</div>
                    <div class="hi-meta">
                        <span>${formatTime(time)}</span>
                        <span>检索模式：${modeLabel}</span>
                        ${h.sources && h.sources.length > 0 ? `<span>参考来源：${h.sources.length}条</span>` : ''}
                    </div>
                </div>
                <button class="history-item-delete" data-id="${h.id}" title="删除该条历史">删除</button>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.history-check').forEach(cb => {
        cb.addEventListener('change', updateHistoryBatchCount);
    });

    container.querySelectorAll('.history-item-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            if (!confirm('确定删除这条问答历史吗？')) return;
            try {
                await apiDelete(`/history/${id}`);
                STATE.history = STATE.history.filter(h => String(h.id) !== String(id));
                renderHistoryList();
                showToast('历史记录已删除', 'success');
            } catch (e) {
                showToast('删除失败', 'error');
            }
        });
    });
}

function loadLocalHistory() {
    try {
        const data = localStorage.getItem('fitqa_history');
        return data ? JSON.parse(data) : [];
    } catch {
        return [];
    }
}

// ==================== 工具函数 ====================
function formatTime(date) {
    const d = date instanceof Date ? date : new Date(date);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
}

function formatDateTime(str) {
    if (!str) return '';
    // 后端存储为北京时间 "YYYY-MM-DD HH:MM:SS"，直接原样显示，避免浏览器时区干扰
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str)) {
        return str.substring(0, 16);
    }
    // 兼容 ISO 格式（带时区），统一按北京时间（UTC+8）显示
    const d = new Date(str);
    if (isNaN(d.getTime())) return str;
    const bj = new Date(d.getTime() + 8 * 3600 * 1000);
    const y = bj.getUTCFullYear();
    const mo = (bj.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = bj.getUTCDate().toString().padStart(2, '0');
    const h = bj.getUTCHours().toString().padStart(2, '0');
    const mi = bj.getUTCMinutes().toString().padStart(2, '0');
    return `${y}-${mo}-${day} ${h}:${mi}`;
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ==================== 高级设置 ====================
function initSettings() {
    const btnSettings = document.getElementById('btnSettings');
    const btnCloseSettings = document.getElementById('btnCloseSettings');
    const btnCancelSettings = document.getElementById('btnCancelSettings');
    const btnApplyMode = document.getElementById('btnApplyMode');
    const btnAddModel = document.getElementById('btnAddModel');
    const btnSaveNewModel = document.getElementById('btnSaveNewModel');
    const btnCancelAddModel = document.getElementById('btnCancelAddModel');
    const btnTestNewModel = document.getElementById('btnTestNewModel');
    const btnToggleNewKey = document.getElementById('btnToggleNewKey');
    const btnSelectModel = document.getElementById('btnSelectModel');
    const btnCloseModelSelect = document.getElementById('btnCloseModelSelect');
    const modelSelectModal = document.getElementById('modelSelectModal');
    const modal = document.getElementById('settingsModal');

    btnSettings.addEventListener('click', openSettings);
    btnCloseSettings.addEventListener('click', closeSettings);
    btnCancelSettings.addEventListener('click', closeSettings);
    btnApplyMode.addEventListener('click', applyMode);
    btnAddModel.addEventListener('click', toggleAddModelForm);
    btnSaveNewModel.addEventListener('click', saveNewModel);
    btnCancelAddModel.addEventListener('click', hideAddModelForm);
    btnTestNewModel.addEventListener('click', testNewModelConnection);
    btnToggleNewKey.addEventListener('click', () => {
        const input = document.getElementById('newModelKey');
        input.type = input.type === 'password' ? 'text' : 'password';
    });
    if (btnSelectModel) btnSelectModel.addEventListener('click', openModelSelectModal);
    if (btnCloseModelSelect) btnCloseModelSelect.addEventListener('click', closeModelSelectModal);
    if (modelSelectModal) modelSelectModal.addEventListener('click', (e) => {
        if (e.target === modelSelectModal) closeModelSelectModal();
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeSettings();
    });

    // 点击模式按钮仅切换选中态，通过"应用"按钮生效
    document.querySelectorAll('#settingsModal .mode-btn').forEach(btn => {
        btn.addEventListener('click', () => selectModeTab(btn.dataset.mode));
    });
}

function selectModeTab(mode) {
    if (!['mock', 'real'].includes(mode)) return;
    document.querySelectorAll('#settingsModal .mode-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`#settingsModal .mode-btn[data-mode="${mode}"]`);
    if (btn) btn.classList.add('active');
    updateApplyModeBtn(mode);
    toggleLlmConfigVisibility(mode === 'real');
}

function updateApplyModeBtn(mode) {
    const btn = document.getElementById('btnApplyMode');
    if (!btn) return;
    btn.textContent = mode === 'real' ? '应用大模型模式' : '应用离线模式';
}

async function applyMode() {
    const activeBtn = document.querySelector('#settingsModal .mode-btn.active');
    const mode = activeBtn ? activeBtn.dataset.mode : 'mock';
    const label = mode === 'real' ? '大模型' : '离线';
    const btn = document.getElementById('btnApplyMode');
    btn.disabled = true;
    btn.textContent = '应用中...';
    try {
        const resp = await fetch(`${API_BASE_URL}/config/mode`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode }),
        });
        const data = await resp.json();
        if (!resp.ok) {
            showSettingsToast(data.detail || '切换失败', 'error');
            await loadSettings();
            return;
        }
        showSettingsToast(`已切换到${label}模式`, 'success');
        await checkBackendHealth();
        await loadSettings();
    } catch (e) {
        showSettingsToast(`切换失败: ${e.message}`, 'error');
        await loadSettings();
    } finally {
        btn.disabled = false;
        updateApplyModeBtn(mode);
    }
}

async function openSettings() {
    const modal = document.getElementById('settingsModal');
    modal.classList.add('active');
    await loadSettings();
}

function closeSettings() {
    const modal = document.getElementById('settingsModal');
    modal.classList.remove('active');
    hideAddModelForm();
    closeModelSelectModal();
}

async function loadSettings() {
    try {
        const resp = await fetch(`${API_BASE_URL}/config`);
        if (resp.ok) {
            const config = await resp.json();
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            const activeBtn = document.querySelector(`.mode-btn[data-mode="${config.mode}"]`);
            if (activeBtn) activeBtn.classList.add('active');
            toggleLlmConfigVisibility(config.mode === 'real');
            updateApplyModeBtn(config.mode);
            const modeLabel = document.getElementById('currentModeLabel');
            if (modeLabel) modeLabel.textContent = config.mode === 'real' ? '大模型模式' : '离线模式';
        }
    } catch (e) {
        console.warn('[Settings] Failed to load config:', e.message);
    }
    await loadModelList();
}

async function loadModelList() {
    const listEl = document.getElementById('modelList');
    const emptyEl = document.getElementById('modelListEmpty');
    try {
        const resp = await fetch(`${API_BASE_URL}/config/models`);
        if (!resp.ok) throw new Error('加载失败');
        const data = await resp.json();
        renderModelList(data.models, data.active_model_id);
        updateCurrentModelDisplay(data.models, data.active_model_id);
    } catch (e) {
        console.warn('[Models] Failed to load:', e.message);
        listEl.innerHTML = '<div class="model-list-empty">加载失败</div>';
    }
}

function updateCurrentModelDisplay(models, activeId) {
    const el = document.getElementById('currentModelName');
    if (!el) return;
    const active = (models || []).find(m => m.id === activeId);
    el.textContent = active ? active.name : '未选择';
}

function renderModelList(models, activeId) {
    const listEl = document.getElementById('modelList');
    if (!models || models.length === 0) {
        listEl.innerHTML = '<div class="model-list-empty">暂无模型，请点击下方按钮添加</div>';
        return;
    }
    listEl.innerHTML = models.map(m => `
        <div class="model-card ${m.id === activeId ? 'active' : ''}" data-id="${m.id}">
            <div class="model-info" onclick="switchModel(${m.id})">
                <div class="model-name">${escapeHtml(m.name)}</div>
                <div class="model-detail">${escapeHtml(m.model_name)} · ${m.api_key_masked}</div>
            </div>
            <div class="model-actions">
                ${m.id === activeId
                    ? '<span class="model-badge">使用中</span>'
                    : `<button class="btn btn-sm btn-outline" onclick="switchModel(${m.id})">切换</button>`
                }
                <button class="btn btn-sm btn-outline" onclick="openEditModel(${m.id})" title="编辑">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="btn btn-sm btn-danger-icon" onclick="removeModel(${m.id}, '${escapeHtml(m.name)}')" title="删除">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
}

let editingModelId = null;

function openEditModel(id) {
    const btnAdd = document.getElementById('btnAddModel');
    const form = document.getElementById('addModelForm');
    form.classList.remove('hidden');
    if (btnAdd) btnAdd.style.display = 'none';

    editingModelId = id;
    document.getElementById('newModelName').value = '';
    document.getElementById('newModelUrl').value = '';
    document.getElementById('newModelKey').value = '';
    document.getElementById('newModelModelName').value = '';
    document.getElementById('testNewModelResult').className = 'test-result';
    document.getElementById('testNewModelResult').textContent = '';

    fetch(`${API_BASE_URL}/config/models`)
        .then(r => r.json())
        .then(data => {
            const m = (data.models || []).find(x => x.id === id);
            if (m) {
                document.getElementById('newModelName').value = m.name;
                document.getElementById('newModelUrl').value = m.base_url;
                document.getElementById('newModelModelName').value = m.model_name;
                document.getElementById('newModelKey').placeholder = '留空保持不变（当前: ' + m.api_key_masked + '）';
            }
        })
        .catch(() => {});
}

async function switchModel(id) {
    try {
        const resp = await fetch(`${API_BASE_URL}/config/models/${id}/activate`, { method: 'PUT' });
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.detail || '切换失败');
        }
        showSettingsToast('模型已切换', 'success');
        await loadModelList();
        await checkBackendHealth();
    } catch (e) {
        showSettingsToast(`切换失败: ${e.message}`, 'error');
    }
}

async function removeModel(id, name) {
    if (!confirm(`确定删除模型 "${name}" 吗？`)) return;
    try {
        const resp = await fetch(`${API_BASE_URL}/config/models/${id}`, { method: 'DELETE' });
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.detail || '删除失败');
        }
        showSettingsToast('模型已删除', 'success');
        await loadModelList();
        await checkBackendHealth();
    } catch (e) {
        showSettingsToast(`删除失败: ${e.message}`, 'error');
    }
}

function toggleAddModelForm() {
    const form = document.getElementById('addModelForm');
    editingModelId = null;
    form.classList.toggle('hidden');
    if (form.classList.contains('hidden')) {
        const btnAdd = document.getElementById('btnAddModel');
        if (btnAdd) btnAdd.style.display = '';
    }
    resetModelFormFields();
}

function hideAddModelForm() {
    const form = document.getElementById('addModelForm');
    form.classList.add('hidden');
    const btnAdd = document.getElementById('btnAddModel');
    if (btnAdd) btnAdd.style.display = '';
    editingModelId = null;
    resetModelFormFields();
}

function resetModelFormFields() {
    document.getElementById('newModelName').value = '';
    document.getElementById('newModelUrl').value = '';
    document.getElementById('newModelKey').value = '';
    document.getElementById('newModelModelName').value = '';
    document.getElementById('newModelKey').placeholder = 'sk-...';
    document.getElementById('testNewModelResult').className = 'test-result';
    document.getElementById('testNewModelResult').textContent = '';
}

async function saveNewModel() {
    const name = document.getElementById('newModelName').value.trim();
    const baseUrl = document.getElementById('newModelUrl').value.trim();
    const apiKey = document.getElementById('newModelKey').value.trim();
    const modelName = document.getElementById('newModelModelName').value.trim();

    if (!name) { showToast('请输入模型别名', 'error'); return; }
    if (!baseUrl) { showToast('请输入 API 地址', 'error'); return; }
    if (editingModelId === null && !apiKey) { showToast('请输入 API Key', 'error'); return; }
    if (!modelName) { showToast('请输入模型名称', 'error'); return; }

    try {
        const isEdit = editingModelId !== null;
        const url = isEdit ? `${API_BASE_URL}/config/models/${editingModelId}` : `${API_BASE_URL}/config/models`;
        const resp = await fetch(url, {
            method: isEdit ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, base_url: baseUrl, api_key: apiKey, model_name: modelName }),
        });
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.detail || '保存失败');
        }
        showSettingsToast(isEdit ? '模型已更新' : '模型已添加', 'success');
        hideAddModelForm();
        await loadModelList();
        await checkBackendHealth();
    } catch (e) {
        showSettingsToast(`保存失败: ${e.message}`, 'error');
    }
}

async function testNewModelConnection() {
    const baseUrl = document.getElementById('newModelUrl').value.trim();
    const apiKey = document.getElementById('newModelKey').value.trim();
    const modelName = document.getElementById('newModelModelName').value.trim();
    const resultEl = document.getElementById('testNewModelResult');

    if (!baseUrl || !modelName) {
        resultEl.className = 'test-result show error';
        resultEl.textContent = '请填写 API 地址和模型名称';
        return;
    }

    const btn = document.getElementById('btnTestNewModel');
    btn.disabled = true;
    btn.textContent = '测试中...';
    resultEl.className = 'test-result show';
    resultEl.textContent = '正在测试连接...';

    try {
        const resp = await fetch(`${API_BASE_URL}/config/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base_url: baseUrl, api_key: apiKey || 'test', model_name: modelName }),
        });
        const data = await resp.json();
        if (data.success) {
            resultEl.className = 'test-result show success';
            resultEl.textContent = `${data.message} (${data.latency_ms}ms)`;
        } else {
            resultEl.className = 'test-result show error';
            resultEl.textContent = data.message;
        }
    } catch (e) {
        resultEl.className = 'test-result show error';
        resultEl.textContent = `测试请求失败: ${e.message}`;
    } finally {
        btn.disabled = false;
        btn.textContent = '测试连接';
    }
}

function toggleLlmConfigVisibility(show) {
    const group = document.getElementById('currentModelGroup');
    const manageGroup = document.getElementById('modelManageGroup');
    if (show) {
        group.classList.remove('hidden');
        if (manageGroup) manageGroup.classList.remove('hidden');
    } else {
        group.classList.add('hidden');
        if (manageGroup) manageGroup.classList.add('hidden');
    }
}

// ==================== 设置弹窗内提示（界面正下方） ====================
let settingsToastTimer = null;

function showSettingsToast(msg, type = 'info') {
    const el = document.getElementById('settingsToast');
    if (!el) return;
    el.textContent = msg;
    el.className = `settings-toast show ${type}`;
    clearTimeout(settingsToastTimer);
    settingsToastTimer = setTimeout(() => {
        el.className = 'settings-toast';
    }, 3000);
}

// ==================== 模型选择弹窗 ====================
async function openModelSelectModal() {
    const modal = document.getElementById('modelSelectModal');
    modal.classList.add('active');
    try {
        const resp = await fetch(`${API_BASE_URL}/config/models`);
        if (!resp.ok) throw new Error('加载失败');
        const data = await resp.json();
        renderModelSelectList(data.models, data.active_model_id);
    } catch (e) {
        document.getElementById('modelSelectList').innerHTML = '<div class="model-list-empty">加载失败</div>';
    }
}

function closeModelSelectModal() {
    document.getElementById('modelSelectModal').classList.remove('active');
}

function renderModelSelectList(models, activeId) {
    const listEl = document.getElementById('modelSelectList');
    if (!models || models.length === 0) {
        listEl.innerHTML = '<div class="model-list-empty">暂无模型，请先在设置中添加模型</div>';
        return;
    }
    listEl.innerHTML = models.map(m => `
        <div class="model-card ${m.id === activeId ? 'active' : ''}" data-id="${m.id}">
            <div class="model-info">
                <div class="model-name">${escapeHtml(m.name)}</div>
                <div class="model-detail">${escapeHtml(m.model_name)} · ${m.api_key_masked}</div>
            </div>
            ${m.id === activeId ? '<span class="model-badge">使用中</span>' : ''}
        </div>
    `).join('');

    listEl.querySelectorAll('.model-card').forEach(card => {
        card.addEventListener('click', () => {
            const id = Number(card.dataset.id);
            if (id === activeId) {
                closeModelSelectModal();
                return;
            }
            selectModelFromModal(id);
        });
    });
}

async function selectModelFromModal(id) {
    const wasMock = document.querySelector('#settingsModal .mode-btn.active')?.dataset.mode === 'mock';
    try {
        const resp = await fetch(`${API_BASE_URL}/config/models/${id}/activate`, { method: 'PUT' });
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.detail || '切换失败');
        }
        if (wasMock) {
            // 离线模式下选择模型后保持离线模式，仅切换激活模型
            await fetch(`${API_BASE_URL}/config/mode`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'mock' }),
            });
        }
        showSettingsToast('模型已选择', 'success');
        closeModelSelectModal();
        await loadModelList();
        await checkBackendHealth();
    } catch (e) {
        showSettingsToast(`选择失败: ${e.message}`, 'error');
    }
}

// ==================== 知识库导入（合并到知识管理弹窗） ====================
let importFiles = [];
let importMode = 'manual'; // manual=手动导入, smart=智能导入

function initImport() {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('importFiles');
    const btnStart = document.getElementById('btnStartImport');
    const btnRebuild = document.getElementById('btnRebuildIndex');

    if (uploadArea) {
        uploadArea.addEventListener('click', () => fileInput.click());
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });
        uploadArea.addEventListener('drop', handleDrop);
    }
    if (fileInput) fileInput.addEventListener('change', handleFileSelect);
    if (btnStart) btnStart.addEventListener('click', startImport);
    if (btnRebuild) btnRebuild.addEventListener('click', rebuildIndex);

    // 手动/智能导入模式切换
    document.querySelectorAll('.import-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => switchImportMode(btn.dataset.mode));
    });

    // 新增知识 / 导入文档 tab 切换
    document.querySelectorAll('#knowledgeTabs .modal-tab').forEach(tab => {
        tab.addEventListener('click', () => switchKnowledgeTab(tab.dataset.tab));
    });

    // 手动导入：内容分片勾选联动（同新增知识）
    const importSplitEnabled = document.getElementById('importSplitEnabled');
    if (importSplitEnabled) {
        importSplitEnabled.addEventListener('change', () => {
            const group = document.getElementById('importSplitMethodGroup');
            if (group) group.classList.toggle('hidden', !importSplitEnabled.checked);
            const radios = document.querySelectorAll('input[name="importSplitMethod"]');
            if (importSplitEnabled.checked) {
                if (!document.querySelector('input[name="importSplitMethod"]:checked')) {
                    const titleRadio = document.querySelector('input[name="importSplitMethod"][value="title"]');
                    if (titleRadio) titleRadio.checked = true;
                }
            } else {
                radios.forEach(r => r.checked = false);
            }
        });
    }
}

function switchImportMode(mode) {
    importMode = mode;
    document.querySelectorAll('.import-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    // 手动导入显示内容分片选项，智能导入隐藏（模型自动拆分）
    const splitOptionGroup = document.getElementById('importSplitOptionGroup');
    if (splitOptionGroup) splitOptionGroup.classList.toggle('hidden', mode !== 'manual');
    // 智能导入无需手动填来源/链接，来源自动识别为文件名
    const sourceRow = document.getElementById('importSourceRow');
    if (sourceRow) sourceRow.classList.toggle('hidden', mode !== 'manual');
    // 切换模式时重置导入表单
    resetImportForm();
}

// 知识管理弹窗：新增知识 / 导入文档 tab 切换
function switchKnowledgeTab(tab) {
    const tabs = document.querySelectorAll('#knowledgeTabs .modal-tab');
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    const panelEntry = document.getElementById('tabPanelEntry');
    const panelImport = document.getElementById('tabPanelImport');
    if (panelEntry) panelEntry.classList.toggle('hidden', tab !== 'entry');
    if (panelImport) panelImport.classList.toggle('hidden', tab !== 'import');
    // 新增知识 tab 显示底部保存按钮，导入文档 tab 隐藏（用"开始导入"）
    const footer = document.querySelector('#entryModal .modal-footer');
    if (footer) footer.classList.toggle('hidden', tab !== 'entry');
}

function openImportModal() {
    document.getElementById('entryModal').classList.add('active');
    // 导入模式显示顶部 tab 切换
    const knowledgeTabs = document.getElementById('knowledgeTabs');
    if (knowledgeTabs) knowledgeTabs.classList.remove('hidden');
    switchKnowledgeTab('import');
    resetImportForm();
}

function closeImportModal() {
    document.getElementById('entryModal').classList.remove('active');
    resetImportForm();
}

function resetImportForm() {
    importFiles = [];
    document.getElementById('importFiles').value = '';
    const list = document.getElementById('selectedFiles');
    if (list) list.innerHTML = '';
    document.getElementById('uploadArea').classList.remove('hidden');
    document.getElementById('importResult').classList.add('hidden');
    document.getElementById('importResult').textContent = '';
    document.getElementById('btnStartImport').disabled = false;
    document.getElementById('btnStartImport').textContent = '开始导入';
    document.getElementById('importSource').value = '';
    document.getElementById('importUrl').value = '';
    // 重置内容分片选项
    const importSplitEnabled = document.getElementById('importSplitEnabled');
    const importSplitMethodGroup = document.getElementById('importSplitMethodGroup');
    if (importSplitEnabled) importSplitEnabled.checked = false;
    if (importSplitMethodGroup) importSplitMethodGroup.classList.add('hidden');
    document.querySelectorAll('input[name="importSplitMethod"]').forEach(r => r.checked = false);
    // 按当前模式显示/隐藏内容分片选项
    const splitOptionGroup = document.getElementById('importSplitOptionGroup');
    if (splitOptionGroup) splitOptionGroup.classList.toggle('hidden', importMode !== 'manual');
    // 按当前模式显示/隐藏来源与链接（智能导入自动识别来源为文件名）
    const sourceRow = document.getElementById('importSourceRow');
    if (sourceRow) sourceRow.classList.toggle('hidden', importMode !== 'manual');
}

function handleFileSelect(e) {
    const files = Array.from(e.target.files || []);
    files.forEach(f => addImportFile(f));
}

function handleDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files || []);
    files.forEach(f => addImportFile(f));
}

function addImportFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx', 'txt'].includes(ext)) {
        showToast(`「${file.name}」格式不支持，仅支持 PDF / Word / TXT`, 'error');
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        showToast(`「${file.name}」超过 10MB 限制`, 'error');
        return;
    }
    if (importFiles.some(f => f.name === file.name && f.size === file.size)) {
        showToast(`「${file.name}」已添加`, 'error');
        return;
    }
    importFiles.push(file);
    renderSelectedFiles();
}

function renderSelectedFiles() {
    const list = document.getElementById('selectedFiles');
    if (!list) return;
    if (importFiles.length === 0) {
        list.innerHTML = '';
        document.getElementById('uploadArea').classList.remove('hidden');
        return;
    }
    document.getElementById('uploadArea').classList.add('hidden');
    list.innerHTML = importFiles.map((f, i) => `
        <div class="selected-file">
            <span class="file-icon">📄</span>
            <span class="file-name">${escapeHtml(f.name)}</span>
            <button class="btn-remove" data-index="${i}" title="移除">&times;</button>
        </div>
    `).join('');
    list.querySelectorAll('.btn-remove').forEach(btn => {
        btn.addEventListener('click', () => removeImportFile(parseInt(btn.dataset.index, 10)));
    });
}

function removeImportFile(index) {
    importFiles.splice(index, 1);
    renderSelectedFiles();
}

async function startImport() {
    if (importFiles.length === 0) {
        showToast('请先选择文件', 'error');
        return;
    }

    const btn = document.getElementById('btnStartImport');
    const resultEl = document.getElementById('importResult');
    btn.disabled = true;
    btn.textContent = '导入中...';

    // 手动导入：勾选内容分片才切分，未勾选则整篇作为一条；智能导入：模型自动拆分
    let mode = 'direct';
    let splitMethod = 'none';
    if (importMode === 'smart') {
        mode = 'llm';
    } else {
        const splitEnabled = document.getElementById('importSplitEnabled');
        if (splitEnabled && splitEnabled.checked) {
            splitMethod = document.querySelector('input[name="importSplitMethod"]:checked')?.value || 'title';
        }
    }
    const url = document.getElementById('importUrl').value.trim();
    const source = document.getElementById('importSource').value.trim();

    const formData = new FormData();
    importFiles.forEach(f => formData.append('files', f));
    formData.append('mode', mode);
    formData.append('split_method', splitMethod);
    if (url) formData.append('url', url);
    if (source) formData.append('source', source);

    try {
        const resp = await fetch(`${API_BASE_URL}/knowledge/import`, {
            method: 'POST',
            body: formData,
        });
        const data = await resp.json();

        if (resp.ok && data.success) {
            resultEl.className = 'import-result show success';
            resultEl.textContent = data.message;
            showToast(data.message, 'success');
            await initKnowledge();
            resetImportForm();
        } else if (data.skipped) {
            resultEl.className = 'import-result show info';
            resultEl.textContent = data.message;
        } else {
            resultEl.className = 'import-result show error';
            resultEl.textContent = data.detail || data.message || '导入失败';
        }
    } catch (e) {
        resultEl.className = 'import-result show error';
        resultEl.textContent = `导入失败: ${e.message}`;
    } finally {
        btn.disabled = false;
        btn.textContent = '开始导入';
    }
}

async function rebuildIndex() {
    try {
        const resp = await fetch(`${API_BASE_URL}/knowledge/rebuild-index`, { method: 'POST' });
        const data = await resp.json();
        if (resp.ok) {
            showToast(data.message, 'success');
            await initKnowledge();
        } else {
            showToast(data.detail || '重建失败', 'error');
        }
    } catch (e) {
        showToast(`重建失败: ${e.message}`, 'error');
    }
}

// ==================== 知识条目 CRUD ====================
let currentDeleteEntryId = null;

function initEntryModal() {
    const btnAdd = document.getElementById('btnAddKnowledge');
    const btnClose = document.getElementById('btnCloseEntry');
    const btnCancel = document.getElementById('btnCancelEntry');
    const btnSave = document.getElementById('btnSaveEntry');
    const modal = document.getElementById('entryModal');
    const btnCloseDelete = document.getElementById('btnCloseDeleteConfirm');
    const btnCancelDelete = document.getElementById('btnCancelDelete');
    const btnConfirmDelete = document.getElementById('btnConfirmDelete');
    const deleteModal = document.getElementById('deleteConfirmModal');

    if (btnAdd) btnAdd.addEventListener('click', openAddEntryModal);
    if (btnClose) btnClose.addEventListener('click', closeEntryModal);
    if (btnCancel) btnCancel.addEventListener('click', closeEntryModal);
    if (btnSave) btnSave.addEventListener('click', saveEntry);

    const splitEnabled = document.getElementById('entrySplitEnabled');
    if (splitEnabled) {
        splitEnabled.addEventListener('change', () => {
            const group = document.getElementById('splitMethodGroup');
            if (group) group.classList.toggle('hidden', !splitEnabled.checked);
            const radios = document.querySelectorAll('input[name="entrySplitMethod"]');
            if (splitEnabled.checked) {
                // 勾选分片时，若未选择分片方式则默认按标题拆分
                if (!document.querySelector('input[name="entrySplitMethod"]:checked')) {
                    const titleRadio = document.querySelector('input[name="entrySplitMethod"][value="title"]');
                    if (titleRadio) titleRadio.checked = true;
                }
            } else {
                // 取消勾选时清空所有分片方式选中态，避免误会
                radios.forEach(r => r.checked = false);
            }
        });
    }

    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeEntryModal(); });

    if (btnCloseDelete) btnCloseDelete.addEventListener('click', closeDeleteConfirm);
    if (btnCancelDelete) btnCancelDelete.addEventListener('click', closeDeleteConfirm);
    if (btnConfirmDelete) btnConfirmDelete.addEventListener('click', executeDeleteEntry);
    if (deleteModal) deleteModal.addEventListener('click', (e) => { if (e.target === deleteModal) closeDeleteConfirm(); });

    // 批量操作入口
    const btnBatchKnowledge = document.getElementById('btnBatchKnowledge');
    if (btnBatchKnowledge) btnBatchKnowledge.addEventListener('click', enterKnowledgeBatchMode);

    // 批量编辑弹窗
    const btnBatchEdit = document.getElementById('btnBatchEditKnowledge');
    if (btnBatchEdit) btnBatchEdit.addEventListener('click', openBatchEditModal);
    const btnBatchDelete = document.getElementById('btnBatchDeleteKnowledge');
    if (btnBatchDelete) btnBatchDelete.addEventListener('click', executeBatchDeleteKnowledge);
    const btnCancelKnowledgeBatch = document.getElementById('btnCancelKnowledgeBatch');
    if (btnCancelKnowledgeBatch) btnCancelKnowledgeBatch.addEventListener('click', exitKnowledgeBatchMode);
    const knowledgeCheckAll = document.getElementById('knowledgeCheckAll');
    if (knowledgeCheckAll) {
        knowledgeCheckAll.addEventListener('change', () => {
            document.querySelectorAll('.knowledge-check').forEach(cb => {
                cb.checked = knowledgeCheckAll.checked;
            });
            updateKnowledgeBatchCount();
        });
    }
    const batchEditModal = document.getElementById('batchEditModal');
    const btnCloseBatchEdit = document.getElementById('btnCloseBatchEdit');
    const btnCancelBatchEdit = document.getElementById('btnCancelBatchEdit');
    const btnSaveBatchEdit = document.getElementById('btnSaveBatchEdit');
    if (btnCloseBatchEdit) btnCloseBatchEdit.addEventListener('click', closeBatchEditModal);
    if (btnCancelBatchEdit) btnCancelBatchEdit.addEventListener('click', closeBatchEditModal);
    if (btnSaveBatchEdit) btnSaveBatchEdit.addEventListener('click', saveBatchEdit);
    if (batchEditModal) batchEditModal.addEventListener('click', (e) => { if (e.target === batchEditModal) closeBatchEditModal(); });
}

function openAddEntryModal() {
    document.getElementById('entryId').value = '';
    document.getElementById('entryTitle').value = '';
    document.getElementById('entryCategory').value = '';
    document.getElementById('entryContent').value = '';
    document.getElementById('entrySource').value = '';
    document.getElementById('entryUrl').value = '';
    document.getElementById('entryTags').value = '';
    // 重置分片选项
    const splitEnabled = document.getElementById('entrySplitEnabled');
    const splitMethodGroup = document.getElementById('splitMethodGroup');
    if (splitEnabled) {
        splitEnabled.checked = false;
        splitEnabled.disabled = false;
    }
    if (splitMethodGroup) splitMethodGroup.classList.add('hidden');
    // 清空分片方式选中态，避免未勾选分片时误显示已选
    document.querySelectorAll('input[name="entrySplitMethod"]').forEach(r => r.checked = false);
    const splitOptionGroup = document.getElementById('splitOptionGroup');
    if (splitOptionGroup) splitOptionGroup.classList.remove('hidden');
    // 新增模式显示顶部 tab 切换
    const knowledgeTabs = document.getElementById('knowledgeTabs');
    if (knowledgeTabs) knowledgeTabs.classList.remove('hidden');
    populateCategoryDatalist();
    document.getElementById('entryModal').classList.add('active');
    switchKnowledgeTab('entry');
}

function openEditEntryModal(entryId) {
    const entry = STATE.knowledgeCache?.find(k => k.id === entryId);
    if (!entry) {
        showToast('未找到该条目', 'error');
        return;
    }
    document.getElementById('entryId').value = entry.id;
    document.getElementById('entryTitle').value = entry.title || '';
    document.getElementById('entryCategory').value = entry.category || '';
    document.getElementById('entryContent').value = entry.content || '';
    document.getElementById('entrySource').value = entry.source || '';
    document.getElementById('entryUrl').value = entry.url || '';
    document.getElementById('entryTags').value = (entry.tags || []).join(', ');
    // 编辑模式隐藏分片选项（分片仅新增时可用）
    const splitOptionGroup = document.getElementById('splitOptionGroup');
    if (splitOptionGroup) splitOptionGroup.classList.add('hidden');
    // 编辑模式隐藏顶部 tab 切换（仅编辑当前条目）
    const knowledgeTabs = document.getElementById('knowledgeTabs');
    if (knowledgeTabs) knowledgeTabs.classList.add('hidden');
    populateCategoryDatalist();
    document.getElementById('entryModal').classList.add('active');
    switchKnowledgeTab('entry');
}

function closeEntryModal() {
    document.getElementById('entryModal').classList.remove('active');
}

function populateCategoryDatalist() {
    const datalist = document.getElementById('categoryList');
    const categories = STATE.categoriesCache || [];
    datalist.innerHTML = categories.map(c => `<option value="${escapeHtml(c.category)}">`).join('');
}

async function saveEntry() {
    const entryId = document.getElementById('entryId').value;
    const title = document.getElementById('entryTitle').value.trim();
    const category = document.getElementById('entryCategory').value.trim();
    const content = document.getElementById('entryContent').value.trim();
    const source = document.getElementById('entrySource').value.trim();
    const url = document.getElementById('entryUrl').value.trim();
    const tagsStr = document.getElementById('entryTags').value.trim();

    if (!title) { showToast('请输入标题', 'error'); return; }
    if (!category) { showToast('请输入分类', 'error'); return; }
    if (!content) { showToast('请输入内容', 'error'); return; }
    if (!source) { showToast('请输入来源', 'error'); return; }

    const tags = tagsStr ? tagsStr.split(/[,，]/).map(t => t.trim()).filter(Boolean) : [];
    const body = { title, category, content, source, url, tags };

    // 新增时支持分片
    if (!entryId) {
        const splitEnabled = document.getElementById('entrySplitEnabled');
        if (splitEnabled && splitEnabled.checked) {
            body.split_enabled = true;
            body.split_method = document.querySelector('input[name="entrySplitMethod"]:checked')?.value || 'title';
        }
    }

    const btnSave = document.getElementById('btnSaveEntry');
    btnSave.disabled = true;
    btnSave.textContent = '保存中...';

    try {
        let resp;
        if (entryId) {
            resp = await fetch(`${API_BASE_URL}/knowledge/entries/${entryId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        } else {
            resp = await fetch(`${API_BASE_URL}/knowledge/entries`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        }

        const data = await resp.json();
        if (resp.ok) {
            showToast(data.message, 'success');
            closeEntryModal();
            await initKnowledge();
        } else {
            showToast(data.detail || '保存失败', 'error');
        }
    } catch (e) {
        showToast(`保存失败: ${e.message}`, 'error');
    } finally {
        btnSave.disabled = false;
        btnSave.textContent = '保存';
    }
}

function openDeleteConfirm(entryId, title) {
    currentDeleteEntryId = entryId;
    document.getElementById('deleteEntryTitle').textContent = title;
    document.getElementById('deleteConfirmModal').classList.add('active');
}

function closeDeleteConfirm() {
    currentDeleteEntryId = null;
    document.getElementById('deleteConfirmModal').classList.remove('active');
}

async function executeDeleteEntry() {
    if (!currentDeleteEntryId) return;

    const btnConfirm = document.getElementById('btnConfirmDelete');
    btnConfirm.disabled = true;
    btnConfirm.textContent = '删除中...';

    try {
        const rebuild = document.getElementById('deleteRebuildIndex')?.checked !== false;
        const url = `${API_BASE_URL}/knowledge/entries/${currentDeleteEntryId}?rebuild=${rebuild ? 1 : 0}`;
        const resp = await fetch(url, { method: 'DELETE' });
        const data = await resp.json();
        if (resp.ok) {
            showToast(data.message, 'success');
            closeDeleteConfirm();
            await initKnowledge();
        } else {
            showToast(data.detail || '删除失败', 'error');
        }
    } catch (e) {
        showToast(`删除失败: ${e.message}`, 'error');
    } finally {
        btnConfirm.disabled = false;
        btnConfirm.textContent = '确认删除';
    }
}

// ==================== 知识批量操作 ====================
function getSelectedKnowledgeIds() {
    const ids = [];
    document.querySelectorAll('.knowledge-check:checked').forEach(cb => {
        if (!String(cb.dataset.id).startsWith('KB')) ids.push(cb.dataset.id);
    });
    return ids;
}

function updateKnowledgeBatchCount() {
    const checkboxes = document.querySelectorAll('.knowledge-check');
    const checked = [...checkboxes].filter(cb => cb.checked);
    const countEl = document.getElementById('knowledgeBatchCount');
    if (countEl) countEl.textContent = `已选 ${checked.length} 项`;
    const checkAll = document.getElementById('knowledgeCheckAll');
    if (checkAll) {
        checkAll.checked = checked.length > 0 && checked.length === checkboxes.length;
    }
}

function enterKnowledgeBatchMode() {
    const bar = document.getElementById('knowledgeBatchBar');
    if (bar) bar.classList.remove('hidden');
    document.body.classList.add('kb-batch-mode');
    updateKnowledgeBatchCount();
}

function exitKnowledgeBatchMode() {
    const bar = document.getElementById('knowledgeBatchBar');
    if (bar) bar.classList.add('hidden');
    document.body.classList.remove('kb-batch-mode');
    document.querySelectorAll('.knowledge-check').forEach(cb => cb.checked = false);
    const checkAll = document.getElementById('knowledgeCheckAll');
    if (checkAll) checkAll.checked = false;
    updateKnowledgeBatchCount();
}

function openBatchEditModal() {
    const ids = getSelectedKnowledgeIds();
    const kbCount = document.querySelectorAll('.knowledge-check:checked').length - ids.length;
    if (ids.length === 0) {
        showToast(kbCount > 0 ? 'KB 内置知识不可编辑，请勾选其他条目' : '请先勾选要编辑的知识条目', 'error');
        return;
    }
    if (kbCount > 0) showToast(`已跳过 ${kbCount} 条 KB 内置知识`, 'info');
    document.getElementById('batchEditCount').textContent = `已选 ${ids.length} 条知识`;
    document.getElementById('batchEditCategory').value = '';
    document.getElementById('batchEditSource').value = '';
    document.getElementById('batchEditUrl').value = '';
    document.getElementById('batchEditTags').value = '';
    populateCategoryDatalist();
    document.getElementById('batchEditModal').classList.add('active');
}

function closeBatchEditModal() {
    document.getElementById('batchEditModal').classList.remove('active');
}

async function saveBatchEdit() {
    const ids = getSelectedKnowledgeIds();
    if (ids.length === 0) {
        showToast('请先勾选要编辑的知识条目', 'error');
        return;
    }
    const category = document.getElementById('batchEditCategory').value.trim();
    const source = document.getElementById('batchEditSource').value.trim();
    const url = document.getElementById('batchEditUrl').value.trim();
    const tagsStr = document.getElementById('batchEditTags').value.trim();

    if (!category && !source && !url && !tagsStr) {
        showToast('请至少填写一个要修改的字段', 'error');
        return;
    }

    const body = { entry_ids: ids };
    if (category) body.category = category;
    if (source) body.source = source;
    if (url) body.url = url;
    if (tagsStr) body.tags = tagsStr.split(/[,，]/).map(t => t.trim()).filter(Boolean);

    const btnSave = document.getElementById('btnSaveBatchEdit');
    btnSave.disabled = true;
    btnSave.textContent = '保存中...';
    try {
        const resp = await fetch(`${API_BASE_URL}/knowledge/entries/batch`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await resp.json();
        if (resp.ok) {
            showToast(data.message, 'success');
            closeBatchEditModal();
            exitKnowledgeBatchMode();
            await initKnowledge();
        } else {
            showToast(data.detail || '批量更新失败', 'error');
        }
    } catch (e) {
        showToast(`批量更新失败: ${e.message}`, 'error');
    } finally {
        btnSave.disabled = false;
        btnSave.textContent = '保存修改';
    }
}

async function executeBatchDeleteKnowledge() {
    const ids = getSelectedKnowledgeIds();
    const kbCount = document.querySelectorAll('.knowledge-check:checked').length - ids.length;
    if (ids.length === 0) {
        showToast(kbCount > 0 ? 'KB 内置知识不可删除，请勾选其他条目' : '请先勾选要删除的知识条目', 'error');
        return;
    }
    const skipTip = kbCount > 0 ? `（已跳过 ${kbCount} 条 KB 内置知识）` : '';
    if (!confirm(`确定删除选中的 ${ids.length} 条知识吗？删除后不可恢复。${skipTip}`)) return;

    const btn = document.getElementById('btnBatchDeleteKnowledge');
    btn.disabled = true;
    btn.textContent = '删除中...';
    try {
        // 逐条删除（不重建索引），最后统一重建一次
        for (const id of ids) {
            await fetch(`${API_BASE_URL}/knowledge/entries/${id}?rebuild=0`, { method: 'DELETE' });
        }
        await fetch(`${API_BASE_URL}/knowledge/rebuild-index`, { method: 'POST' });
        showToast(`已删除 ${ids.length} 条知识`, 'success');
        exitKnowledgeBatchMode();
        await initKnowledge();
    } catch (e) {
        showToast(`批量删除失败: ${e.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '批量删除';
    }
}

// ==================== 历史批量操作 ====================
function enterHistoryBatchMode() {
    const bar = document.getElementById('historyBatchBar');
    if (bar) bar.classList.remove('hidden');
    document.body.classList.add('history-batch-mode');
    updateHistoryBatchCount();
}

function exitHistoryBatchMode() {
    const bar = document.getElementById('historyBatchBar');
    if (bar) bar.classList.add('hidden');
    document.body.classList.remove('history-batch-mode');
    document.querySelectorAll('.history-check').forEach(cb => cb.checked = false);
    const checkAll = document.getElementById('historyCheckAll');
    if (checkAll) checkAll.checked = false;
    updateHistoryBatchCount();
}

function updateHistoryBatchCount() {
    const ids = [];
    document.querySelectorAll('.history-check:checked').forEach(cb => ids.push(cb.dataset.id));
    const countEl = document.getElementById('historyBatchCount');
    if (countEl) countEl.textContent = `已选 ${ids.length} 项`;
    const checkAll = document.getElementById('historyCheckAll');
    if (checkAll) {
        const total = document.querySelectorAll('.history-check').length;
        checkAll.checked = total > 0 && ids.length === total;
    }
}

async function executeBatchDeleteHistory() {
    const ids = [];
    document.querySelectorAll('.history-check:checked').forEach(cb => ids.push(cb.dataset.id));
    if (ids.length === 0) {
        showToast('请先勾选要删除的历史记录', 'error');
        return;
    }
    if (!confirm(`确定删除选中的 ${ids.length} 条问答历史吗？`)) return;

    const btn = document.getElementById('btnConfirmBatchDeleteHistory');
    btn.disabled = true;
    btn.textContent = '删除中...';
    try {
        await apiDelete('/history', { ids: ids.join(',') });
        STATE.history = STATE.history.filter(h => !ids.includes(String(h.id)));
        exitHistoryBatchMode();
        renderHistoryList();
        showToast(`已删除 ${ids.length} 条历史记录`, 'success');
    } catch (e) {
        showToast('批量删除失败', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '删除选中';
    }
}
