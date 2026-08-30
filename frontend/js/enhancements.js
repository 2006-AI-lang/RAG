/**
 * FitQA Enhancement Module
 * Scene selector, streaming, retrieval prefs, export, version history, category management, import preview
 */
(function() {
  'use strict';

  // ==================== Scene Selector ====================
  var SCENE_CONFIGS = [
    { key: 'auto', label: '智能识别', icon: '🎯', desc: '根据问题自动匹配场景' },
    { key: 'general', label: '通用', icon: '📋', desc: '通用健身知识问答' },
    { key: 'muscle_gain', label: '增肌', icon: '💪', desc: '增肌训练、蛋白质摄入、肌肉增长' },
    { key: 'fat_loss', label: '减脂', icon: '🔥', desc: '减脂训练、有氧运动、热量控制' },
    { key: 'injury', label: '运动损伤', icon: '🩹', desc: '运动损伤预防与康复' },
    { key: 'nutrition', label: '营养', icon: '🥗', desc: '运动营养、饮食搭配' },
  ];

  window.currentScene = 'auto';

  window.categoryScenes = [];

  window.initSceneSelector = function() {
    var btn = document.getElementById('btnSceneToggle');
    var dropdown = document.getElementById('sceneDropdown');
    if (!btn || !dropdown) return;
    window.renderSceneDropdown();
    // 从知识库加载用户自定义分类作为场景
    window.loadCategoryScenes();
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      dropdown.classList.toggle('hidden');
    });
    document.addEventListener('click', function(e) {
      if (!dropdown.contains(e.target) && e.target !== btn) {
        dropdown.classList.add('hidden');
      }
    });
  };

  window.loadCategoryScenes = function() {
    if (typeof window.apiGet !== 'function') return;
    window.apiGet('/knowledge/categories').then(function(cats) {
      if (cats && Array.isArray(cats) && cats.length > 0) {
        window.categoryScenes = cats.map(function(c) {
          return { key: 'cat:' + c.category, label: c.category, icon: '📂', desc: '知识库分类：' + c.category + '（' + (c.count || 0) + '条）' };
        });
        window.renderSceneDropdown();
      }
    }).catch(function() {
      // 静默失败，不影响已有场景
    });
  };

  window.renderSceneDropdown = function() {
    var dropdown = document.getElementById('sceneDropdown');
    if (!dropdown) return;
    var html = SCENE_CONFIGS.map(function(s) {
      var active = s.key === window.currentScene ? ' active' : '';
      return '<button class="scene-option' + active + '" data-scene="' + s.key + '">' +
        '<span class="scene-option-icon">' + s.icon + '</span>' +
        '<span class="scene-option-content">' +
        '<span class="scene-option-label">' + s.label + '</span>' +
        '<span class="scene-option-desc">' + s.desc + '</span>' +
        '</span></button>';
    }).join('');
    // 添加用户自定义分类场景
    if (window.categoryScenes && window.categoryScenes.length > 0) {
      html += '<div class="scene-dropdown-divider"></div>';
      html += '<div class="scene-dropdown-header">知识库分类</div>';
      html += window.categoryScenes.map(function(s) {
        var active = s.key === window.currentScene ? ' active' : '';
        return '<button class="scene-option' + active + '" data-scene="' + s.key + '">' +
          '<span class="scene-option-icon">' + s.icon + '</span>' +
          '<span class="scene-option-content">' +
          '<span class="scene-option-label">' + s.label + '</span>' +
          '<span class="scene-option-desc">' + s.desc + '</span>' +
          '</span></button>';
      }).join('');
    }
    dropdown.innerHTML = html;
    dropdown.querySelectorAll('.scene-option').forEach(function(opt) {
      opt.addEventListener('click', function() {
        window.selectScene(opt.dataset.scene);
        dropdown.classList.add('hidden');
      });
    });
  };

  window.selectScene = function(scene) {
    window.currentScene = scene;
    // 先查找内置场景
    var config = SCENE_CONFIGS.find(function(s) { return s.key === scene; });
    var icon = document.getElementById('currentSceneIcon');
    var label = document.getElementById('currentSceneLabel');
    if (config) {
      if (icon) icon.textContent = config.icon;
      if (label) label.textContent = config.label;
    } else {
      // 查找自定义分类场景
      var catScene = (window.categoryScenes || []).find(function(s) { return s.key === scene; });
      if (catScene) {
        if (icon) icon.textContent = catScene.icon;
        // 去掉 "cat:" 前缀显示分类名
        if (label) label.textContent = catScene.label;
      } else {
        if (icon) icon.textContent = '🎯';
        if (label) label.textContent = '智能识别';
      }
    }
    window.renderSceneDropdown();
  };

  // ==================== Streaming SSE ====================
  let streamingController = null;

  window.handleSendMessageStream = async function() {
    var input = document.getElementById('chatInput');
    var question = input.value.trim();
    if (!question) return;

    var modeRadio = document.querySelector('input[name="searchMode"]:checked');
    var mode = modeRadio ? modeRadio.value : 'hybrid';

    if (!window.getCurrentSession()) await window.createSession();
    var session = window.getCurrentSession();
    var history = session.messages.slice(-6).map(function(m) {
      return { role: m.role === 'user' ? 'user' : 'assistant', content: m.content };
    });

    var userMsg = { role: 'user', content: question, time: window.formatTime(new Date()) };
    session.messages.push(userMsg);
    if (session.messages.length === 1 || session.title === '新对话') {
      session.title = question.length > 20 ? question.substring(0, 20) + '...' : question;
    }

    input.value = '';
    input.style.height = 'auto';
    window.renderSessionList();
    window.renderMessages();

    var container = document.getElementById('chatMessages');
    var typingDiv = document.createElement('div');
    typingDiv.className = 'message assistant';
    typingDiv.innerHTML = '<div class="message-avatar">AI</div><div class="message-bubble"><span class="streaming-cursor"></span></div>';
    container.appendChild(typingDiv);
    var bubble = typingDiv.querySelector('.message-bubble');
    container.scrollTop = container.scrollHeight;

    var fullAnswer = '';
    var sources = [];
    var actualMode = mode;
    var isCached = false;

    var btnSend = document.getElementById('btnSend');
    if (btnSend) {
      btnSend.disabled = false;
      btnSend.classList.add('streaming');
      btnSend.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>';
    }

    var aborted = false;
    var reader = null;
    streamingController = {
        get reader() { return reader; },
        get aborted() { return aborted; },
        set aborted(v) { aborted = v; },
        cancel: function() { aborted = true; if (reader) reader.cancel(); }
    };

    if (window.STATE && window.STATE.backendHealthy) {
      try {
        var body = { question: question, mode: mode, history: history, scene: window.currentScene };
        if (window._skipCache) {
            body.skip_cache = true;
            window._skipCache = false;
        }
        if (session.remote && window.isLoggedIn()) body.session_id = session.id;
        var token = window.getToken ? window.getToken() : null;
        var headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = 'Bearer ' + token;

        var resp = await fetch((window.API_BASE_URL || '') + '/ask/stream', {
          method: 'POST', headers: headers, body: JSON.stringify(body),
        });

        if (!resp.ok) {
          var err = await resp.json().catch(function() { return { detail: '请求失败' }; });
          fullAnswer = '请求失败：' + (err.detail || resp.statusText);
        } else {
          reader = resp.body.getReader();
          var decoder = new TextDecoder();
          var buffer = '';
          while (true) {
            var result = await reader.read();
            if (result.done) break;
            if (aborted) break;
            buffer += decoder.decode(result.value, { stream: true });
            var lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i];
              if (line.startsWith('data: ')) {
                try {
                  var data = JSON.parse(line.slice(6));
                  if (data.chunk) {
                    fullAnswer += data.chunk;
                    bubble.innerHTML = '<span class="streaming-cursor"></span>' + (window.formatMessageHTML ? window.formatMessageHTML(fullAnswer) : fullAnswer);
                    container.scrollTop = container.scrollHeight;
                  }
                  if (data.sources && data.sources.length > 0) sources = data.sources;
                  if (data.mode) actualMode = data.mode;
                  if (data.cached) isCached = true;
                  if (data.done) break;
                } catch (e) {}
              }
            }
          }
        }
      } catch (e) {
        if (!aborted) {
          fullAnswer = '请求失败：' + e.message;
        }
      }
    } else {
      fullAnswer = '后端服务不可用。请确认后端已启动。';
    }

    if (btnSend) {
      btnSend.disabled = false;
      btnSend.classList.remove('streaming');
      btnSend.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20"><path d="M2 2 L18 10 L2 18 L5 10 Z" fill="currentColor"/></svg>';
    }
    typingDiv.remove();

    if (aborted) {
      if (fullAnswer && fullAnswer.trim()) {
        fullAnswer += '\n\n---\n⚠️ 回答已手动停止';
      } else {
        fullAnswer = '⚠️ 回答已手动停止';
      }
    }
    var assistantMsg = { role: 'assistant', content: fullAnswer, sources: sources, mode: actualMode, cached: isCached, time: window.formatTime(new Date()) };
    session.messages.push(assistantMsg);
    window.renderMessages();

    if (window._pendingPlanSave) {
      var planInfo = window._pendingPlanSave;
      window._pendingPlanSave = null;
      if (window.autoSaveTrainingPlan) {
        window.autoSaveTrainingPlan(question, fullAnswer, planInfo);
      }
    }

    if (window.STATE && window.STATE.backendHealthy && window.isLoggedIn && window.isLoggedIn()) {
      if (window.loadHistoryFromBackend) window.loadHistoryFromBackend();
    }
    streamingController = null;
  };

  window.stopStreaming = function() {
    if (streamingController) {
      streamingController.cancel();
      var btnSend = document.getElementById('btnSend');
      if (btnSend) {
        btnSend.disabled = false;
        btnSend.classList.remove('streaming');
        btnSend.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20"><path d="M2 2 L18 10 L2 18 L5 10 Z" fill="currentColor"/></svg>';
      }
      streamingController = null;
    }
  };

  // Patch handleSendMessage to use streaming
  var checkPatch = setInterval(function() {
    if (window.handleSendMessage) {
      clearInterval(checkPatch);
      var orig = window.handleSendMessage;
      window.handleSendMessage = async function() {
        if (window.STATE && window.STATE.backendHealthy) {
          await window.handleSendMessageStream();
        } else {
          await orig();
        }
      };
    }
  }, 50);

  // ==================== Retrieval Prefs ====================
  window.initRetrievalPrefs = function() {
    var btnSave = document.getElementById('btnSaveRetrievalPrefs');
    var topKSlider = document.getElementById('retrievalTopKSlider');
    var topKInput = document.getElementById('retrievalTopK');
    var scoreSlider = document.getElementById('retrievalScoreSlider');
    var scoreInput = document.getElementById('retrievalScore');
    if (!btnSave) return;
    if (topKSlider && topKInput) {
      topKSlider.addEventListener('input', function() { topKInput.value = topKSlider.value; });
      topKInput.addEventListener('input', function() {
        var v = parseInt(topKInput.value) || 5;
        topKSlider.value = Math.min(20, Math.max(1, v));
      });
    }
    if (scoreSlider && scoreInput) {
      scoreSlider.addEventListener('input', function() { scoreInput.value = scoreSlider.value; });
      scoreInput.addEventListener('input', function() {
        var v = parseInt(scoreInput.value) || 30;
        scoreSlider.value = Math.min(100, Math.max(0, v));
      });
    }
    btnSave.addEventListener('click', window.saveRetrievalPrefs);
    window.loadRetrievalPrefs();
  };

  window.loadRetrievalPrefs = async function() {
    if (!window.isLoggedIn || !window.isLoggedIn() || !window.STATE || !window.STATE.backendHealthy) return;
    try {
      var resp = await fetch((window.API_BASE_URL || '') + '/config/retrieval', { headers: window.authHeaders() });
      if (!resp.ok) return;
      var data = await resp.json();
      var topK = document.getElementById('retrievalTopK');
      var topKSlider = document.getElementById('retrievalTopKSlider');
      var score = document.getElementById('retrievalScore');
      var scoreSlider = document.getElementById('retrievalScoreSlider');
      var k = data.default_top_k || 5;
      if (topK) topK.value = k;
      if (topKSlider) topKSlider.value = Math.min(20, k);
      var s = Math.round((data.min_vector_score || 0.30) * 100);
      if (score) score.value = s;
      if (scoreSlider) scoreSlider.value = s;
    } catch (e) {}
  };

  window.saveRetrievalPrefs = async function() {
    if (window.requireLogin && !window.requireLogin()) return;
    var topK = parseInt(document.getElementById('retrievalTopK').value) || 5;
    var score = Math.max(0, Math.min(100, parseInt(document.getElementById('retrievalScore').value) || 30)) / 100;
    var btn = document.getElementById('btnSaveRetrievalPrefs');
    btn.disabled = true;
    btn.textContent = '保存中...';
    try {
      var resp = await fetch((window.API_BASE_URL || '') + '/config/retrieval', {
        method: 'PUT',
        headers: window.authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ default_top_k: topK, min_vector_score: score }),
      });
      var data = await resp.json();
      if (resp.ok) {
        if (window.showSettingsToast) window.showSettingsToast('检索偏好已保存', 'success');
      } else {
        if (window.showSettingsToast) window.showSettingsToast(data.detail || '保存失败', 'error');
      }
    } catch (e) {
      if (window.showSettingsToast) window.showSettingsToast('保存失败: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '保存检索偏好';
    }
  };

  var openSettingsCheck = setInterval(function() {
    if (window.openSettings) {
      clearInterval(openSettingsCheck);
      var orig = window.openSettings;
      window.openSettings = async function() {
        await orig();
        window.loadRetrievalPrefs();
      };
    }
  }, 50);

  // ==================== Export Knowledge ====================
  window.initExportKnowledge = function() {
    var btnExport = document.getElementById('btnExportKnowledge');
    var dropdown = document.getElementById('exportDropdown');
    if (!btnExport || !dropdown) return;
    btnExport.addEventListener('click', function(e) {
      e.stopPropagation();
      dropdown.classList.toggle('hidden');
    });
    document.addEventListener('click', function(e) {
      if (!dropdown.contains(e.target) && e.target !== btnExport) {
        dropdown.classList.add('hidden');
      }
    });
    dropdown.querySelectorAll('.export-option').forEach(function(opt) {
      opt.addEventListener('click', function() {
        window.exportKnowledge(opt.dataset.format);
        dropdown.classList.add('hidden');
      });
    });
  };

  window.exportKnowledge = async function(format) {
    if (window.requireLogin && !window.requireLogin()) return;
    try {
      var resp = await fetch((window.API_BASE_URL || '') + '/knowledge/export', {
        method: 'POST',
        headers: window.authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ format: format }),
      });
      if (!resp.ok) {
        var data = await resp.json();
        throw new Error(data.detail || '导出失败');
      }
      var blob = await resp.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      var extMap = { 'json': 'json', 'csv': 'csv', 'markdown': 'md', 'pdf': 'pdf', 'docx': 'docx', 'txt': 'txt' };
      var ext = extMap[format] || 'json';
      a.download = 'fitqa_knowledge_' + new Date().toISOString().slice(0, 10) + '.' + ext;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      window.showToast('知识库导出成功', 'success');
    } catch (e) {
      window.showToast('导出失败: ' + e.message, 'error');
    }
  };

  // ==================== Version History ====================
  window.initVersionHistory = function() {
    var btnClose = document.getElementById('btnCloseVersionHistory');
    var btnCloseFooter = document.getElementById('btnCloseVersionHistoryFooter');
    var modal = document.getElementById('versionHistoryModal');
    if (btnClose) btnClose.addEventListener('click', window.closeVersionHistory);
    if (btnCloseFooter) btnCloseFooter.addEventListener('click', window.closeVersionHistory);
    if (modal) {
      modal.addEventListener('click', function(e) {
        if (e.target === modal) window.closeVersionHistory();
      });
    }
  };

  window.closeVersionHistory = function() {
    var modal = document.getElementById('versionHistoryModal');
    if (modal) modal.classList.remove('active');
  };

  window.openVersionHistory = async function(entryId) {
    if (window.requireLogin && !window.requireLogin()) return;
    var modal = document.getElementById('versionHistoryModal');
    if (!modal) return;
    document.getElementById('versionEntryId').textContent = entryId;
    document.getElementById('versionEntryTitle').textContent = '加载中...';
    document.getElementById('versionList').innerHTML = '<p style="text-align:center;padding:20px;">加载中...</p>';
    modal.classList.add('active');
    try {
      var resp = await fetch((window.API_BASE_URL || '') + '/knowledge/entries/' + entryId + '/versions', {
        headers: window.authHeaders(),
      });
      if (!resp.ok) throw new Error('加载失败');
      var data = await resp.json();
      document.getElementById('versionEntryTitle').textContent = data.title || entryId;
      window.renderVersionList(data.versions || [], entryId);
    } catch (e) {
      document.getElementById('versionList').innerHTML = '<p style="text-align:center;color:var(--danger);">加载失败: ' + e.message + '</p>';
    }
  };

  window.renderVersionList = function(versions, entryId) {
    var list = document.getElementById('versionList');
    if (!versions || versions.length === 0) {
      list.innerHTML = '<p style="text-align:center;padding:20px;">暂无历史版本</p>';
      return;
    }
    var currentVersion = versions[0] ? versions[0].version : 0;
    list.innerHTML = versions.map(function(v) {
      var isCurrent = v.version === currentVersion;
      var badge = isCurrent ? '<span class="version-item-badge">当前</span>' : '';
      var restoreBtn = !isCurrent ? '<button class="btn-xs btn-primary" onclick="restoreVersion(\'' + entryId + '\', ' + v.version + ')">恢复此版本</button>' : '';
      var date = v.created_at ? v.created_at.slice(0, 10) : '';
      return '<div class="version-item' + (isCurrent ? ' current' : '') + '">' +
        '<div class="version-item-meta"><span class="version-item-number">v' + v.version + '</span>' + badge + '<span class="version-item-date">' + date + '</span></div>' +
        '<div class="version-item-body"><div class="version-item-content">' + window.escapeHtml((v.content || '').substring(0, 300)) + '</div>' +
        '<div class="version-item-actions">' + restoreBtn + '<button class="btn-xs" onclick="viewVersionDetail(\'' + entryId + '\', ' + v.version + ')">查看完整内容</button></div></div></div>';
    }).join('');
  };

  window.restoreVersion = async function(entryId, version) {
    if (!confirm('确定恢复到版本 v' + version + ' 吗？')) return;
    try {
      var resp = await fetch((window.API_BASE_URL || '') + '/knowledge/entries/' + entryId + '/restore', {
        method: 'POST',
        headers: window.authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ version: version }),
      });
      var data = await resp.json();
      if (resp.ok) {
        window.showToast('版本已恢复', 'success');
        window.closeVersionHistory();
        if (window.initKnowledge) await window.initKnowledge();
      } else {
        window.showToast(data.detail || '恢复失败', 'error');
      }
    } catch (e) {
      window.showToast('恢复失败: ' + e.message, 'error');
    }
  };

  window.viewVersionDetail = async function(entryId, version) {
    try {
      var resp = await fetch((window.API_BASE_URL || '') + '/knowledge/entries/' + entryId + '/versions', {
        headers: window.authHeaders(),
      });
      if (!resp.ok) throw new Error('加载失败');
      var data = await resp.json();
      var v = (data.versions || []).find(function(x) { return x.version === version; });
      if (v) alert('版本 v' + version + ' 完整内容：\n\n' + v.content);
    } catch (e) {
      window.showToast('加载失败: ' + e.message, 'error');
    }
  };

  // ==================== Category Management ====================
  window.initCategoryManagement = function() {
    var btnManage = document.getElementById('btnManageCategories');
    var btnClose = document.getElementById('btnCloseCategoryManage');
    var btnCloseFooter = document.getElementById('btnCloseCategoryManageFooter');
    var btnAdd = document.getElementById('btnAddCategory');
    var modal = document.getElementById('categoryManageModal');
    if (!btnManage) return;
    btnManage.addEventListener('click', function() {
      if (window.requireLogin && !window.requireLogin()) return;
      window.openCategoryManage();
    });
    if (btnClose) btnClose.addEventListener('click', window.closeCategoryManage);
    if (btnCloseFooter) btnCloseFooter.addEventListener('click', window.closeCategoryManage);
    if (modal) {
      modal.addEventListener('click', function(e) {
        if (e.target === modal) window.closeCategoryManage();
      });
    }
    if (btnAdd) btnAdd.addEventListener('click', window.addCategory);
  };

  window.closeCategoryManage = function() {
    var modal = document.getElementById('categoryManageModal');
    if (modal) modal.classList.remove('active');
  };

  window.openCategoryManage = async function() {
    var modal = document.getElementById('categoryManageModal');
    if (!modal) return;
    modal.classList.add('active');
    await window.loadCategoryList();
  };

  window.loadCategoryList = async function() {
    var list = document.getElementById('categoryManageList');
    if (!list) return;
    try {
      var resp = await fetch((window.API_BASE_URL || '') + '/knowledge/categories/keywords', {
        headers: window.authHeaders(),
      });
      if (!resp.ok) throw new Error('加载失败');
      var data = await resp.json();
      var categories = data.categories || [];
      if (categories.length === 0) {
        list.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:12px;">暂无分类</p>';
        return;
      }
      list.innerHTML = categories.map(function(c) {
        var kwPreview = (c.keywords || []).slice(0, 5).join('、') + ((c.keywords || []).length > 5 ? '...' : '');
        return '<div class="category-manage-item"><div><div class="category-manage-item-name">' + window.escapeHtml(c.category) + '</div>' +
          '<div class="category-manage-item-keywords">' + kwPreview + '</div></div>' +
          '<div class="category-manage-item-actions">' +
          '<button class="btn-xs btn-primary" onclick="editCategoryKeywords(\'' + window.escapeHtml(c.category) + '\')">管理关键词</button>' +
          '<button class="btn-xs" onclick="deleteCategory(\'' + window.escapeHtml(c.category) + '\')">删除</button></div></div>';
      }).join('');
    } catch (e) {
      list.innerHTML = '<p style="text-align:center;color:var(--danger);">加载失败: ' + e.message + '</p>';
    }
  };

  window.addCategory = async function() {
    var input = document.getElementById('newCategoryName');
    var name = input.value.trim();
    if (!name) { window.showToast('请输入分类名称', 'error'); return; }
    try {
      var resp = await fetch((window.API_BASE_URL || '') + '/knowledge/categories/keywords', {
        method: 'POST',
        headers: window.authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ category: name }),
      });
      var data = await resp.json();
      if (resp.ok) {
        window.showToast('分类已添加', 'success');
        input.value = '';
        await window.loadCategoryList();
        if (window.initKnowledge) await window.initKnowledge();
      } else {
        window.showToast(data.detail || '添加失败', 'error');
      }
    } catch (e) {
      window.showToast('添加失败: ' + e.message, 'error');
    }
  };

  window.deleteCategory = async function(category) {
    if (!confirm('确定删除分类「' + category + '」吗？')) return;
    try {
      var resp = await fetch((window.API_BASE_URL || '') + '/knowledge/categories/' + encodeURIComponent(category), {
        method: 'DELETE', headers: window.authHeaders(),
      });
      var data = await resp.json();
      if (resp.ok) {
        window.showToast('分类已删除', 'success');
        await window.loadCategoryList();
        if (window.initKnowledge) await window.initKnowledge();
      } else {
        window.showToast(data.detail || '删除失败', 'error');
      }
    } catch (e) {
      window.showToast('删除失败: ' + e.message, 'error');
    }
  };

  window.editCategoryKeywords = async function(category) {
    var keywords = prompt('输入「' + category + '」的关键词（逗号分隔）：');
    if (keywords === null) return;
    try {
      var resp = await fetch((window.API_BASE_URL || '') + '/knowledge/categories/' + encodeURIComponent(category), {
        method: 'PUT',
        headers: window.authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ keywords: keywords.split(/[,，]/).map(function(k) { return k.trim(); }).filter(Boolean) }),
      });
      var data = await resp.json();
      if (resp.ok) {
        window.showToast('关键词已更新', 'success');
        await window.loadCategoryList();
      } else {
        window.showToast(data.detail || '更新失败', 'error');
      }
    } catch (e) {
      window.showToast('更新失败: ' + e.message, 'error');
    }
  };

  // ==================== Import Preview ====================
  window.initImportPreview = function() {
    var btnPreview = document.getElementById('btnPreviewImport');
    var btnConfirm = document.getElementById('btnConfirmImport');
    var btnCancel = document.getElementById('btnCancelPreview');
    var checkAll = document.getElementById('importPreviewCheckAll');
    if (btnPreview) btnPreview.addEventListener('click', window.previewImport);
    if (btnConfirm) btnConfirm.addEventListener('click', window.confirmImport);
    if (btnCancel) btnCancel.addEventListener('click', window.hideImportPreview);
    if (checkAll) {
      checkAll.addEventListener('change', function() {
        var checked = checkAll.checked;
        document.querySelectorAll('.import-preview-item input[type="checkbox"]').forEach(function(cb) {
          cb.checked = checked;
        });
      });
    }
  };

  window.hideImportPreview = function() {
    var preview = document.getElementById('importPreview');
    if (preview) preview.classList.add('hidden');
    var btnStart = document.getElementById('btnStartImport');
    if (btnStart) btnStart.style.display = '';
    var btnPreview = document.getElementById('btnPreviewImport');
    if (btnPreview) btnPreview.style.display = 'none';
  };

  window.previewImport = async function() {
    if (window.requireLogin && !window.requireLogin()) return;
    if (typeof importFiles === 'undefined' || importFiles.length === 0) {
      window.showToast('请先选择文件', 'error');
      return;
    }
    var preview = document.getElementById('importPreview');
    var list = document.getElementById('importPreviewList');
    var count = document.getElementById('importPreviewCount');
    if (preview) preview.classList.remove('hidden');
    if (count) count.textContent = '正在解析...';
    if (list) list.innerHTML = '<p style="text-align:center;padding:20px;">正在解析文档...</p>';
    var btnStart = document.getElementById('btnStartImport');
    if (btnStart) btnStart.style.display = 'none';
    var btnPreview = document.getElementById('btnPreviewImport');
    if (btnPreview) btnPreview.style.display = '';
    try {
      var formData = new FormData();
      importFiles.forEach(function(f) { formData.append('files', f); });
      formData.append('mode', 'direct');
      var resp = await fetch((window.API_BASE_URL || '') + '/knowledge/import/preview', {
        method: 'POST', headers: window.authHeaders({}), body: formData,
      });
      var data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || '预览失败');
      window._importPreviewItems = data.entries || [];
      if (count) count.textContent = '共 ' + window._importPreviewItems.length + ' 条';
      if (list) window.renderImportPreviewList(window._importPreviewItems);
    } catch (e) {
      if (list) list.innerHTML = '<p style="color:var(--danger);text-align:center;padding:20px;">' + e.message + '</p>';
      if (count) count.textContent = '';
    }
  };

  window.renderImportPreviewList = function(items) {
    var list = document.getElementById('importPreviewList');
    if (!list) return;
    list.innerHTML = items.map(function(item, i) {
      return '<div class="import-preview-item"><input type="checkbox" checked data-index="' + i + '">' +
        '<div class="import-preview-item-body"><div class="import-preview-item-title">' + window.escapeHtml(item.title || '未命名') + '</div>' +
        '<div class="import-preview-item-content">' + window.escapeHtml((item.content || '').substring(0, 200)) + '</div>' +
        '<div class="import-preview-item-category">分类：' + window.escapeHtml(item.category || '未分类') + '</div></div></div>';
    }).join('');
  };

  window.confirmImport = async function() {
    var checkboxes = document.querySelectorAll('.import-preview-item input[type="checkbox"]:checked');
    var selectedIndices = Array.from(checkboxes).map(function(cb) { return parseInt(cb.dataset.index); });
    if (selectedIndices.length === 0) { window.showToast('请至少选择一条导入', 'error'); return; }
    var selectedEntries = selectedIndices.map(function(i) { return window._importPreviewItems[i]; });
    var btnConfirm = document.getElementById('btnConfirmImport');
    btnConfirm.disabled = true;
    btnConfirm.textContent = '导入中...';
    try {
      var resp = await fetch((window.API_BASE_URL || '') + '/knowledge/import/confirm', {
        method: 'POST',
        headers: window.authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ entries: selectedEntries }),
      });
      var data = await resp.json();
      if (resp.ok) {
        window.showToast('成功导入 ' + (data.count || selectedEntries.length) + ' 条知识', 'success');
        window.hideImportPreview();
        if (window.closeImportModal) window.closeImportModal();
        if (window.initKnowledge) await window.initKnowledge();
      } else {
        window.showToast(data.detail || '导入失败', 'error');
      }
    } catch (e) {
      window.showToast('导入失败: ' + e.message, 'error');
    } finally {
      btnConfirm.disabled = false;
      btnConfirm.textContent = '确认导入选中条目';
    }
  };

  // ==================== Copy Answer ====================
  window.addAnswerActions = function() {
    document.querySelectorAll('.message.assistant').forEach(function(msg) {
      if (msg.querySelector('.answer-actions')) return;
      var actions = document.createElement('div');
      actions.className = 'answer-actions';
      actions.innerHTML = '<button class="btn-icon" title="复制回答" onclick="copyAnswer(this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>';
      msg.appendChild(actions);
    });
  };

  window.copyAnswer = function(btn) {
    var msg = btn.closest('.message');
    var bubble = msg ? msg.querySelector('.message-bubble') : null;
    if (!bubble) return;
    navigator.clipboard.writeText(bubble.textContent).then(function() {
      window.showToast('已复制到剪贴板', 'success');
    }).catch(function() {
      window.showToast('复制失败', 'error');
    });
  };

  var renderCheck = setInterval(function() {
    if (window.renderMessages) {
      clearInterval(renderCheck);
      var orig = window.renderMessages;
      window.renderMessages = function() {
        orig();
        setTimeout(window.addAnswerActions, 50);
      };
    }
  }, 50);

  // ==================== Auto-init ====================
  function doInit() {
    window.initSceneSelector();
    window.initRetrievalPrefs();
    window.initExportKnowledge();
    window.initVersionHistory();
    window.initCategoryManagement();
    window.initImportPreview();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', doInit);
  } else {
    doInit();
  }

  // ==================== Streaming HTML Formatter ====================
  window.formatMessageHTML = function(content) {
    if (!content) return '';
    var t = window.escapeHtml ? window.escapeHtml(content) : content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    t = t.replace(/【(.+?)】/g, '<strong>【$1】</strong>');
    t = t.replace(/\[(\d+)\]/g, '<a class="ref-link" href="#source-$1" title="跳转到参考资料$1">[$1]</a>');
    t = t.replace(/\n/g, '<br>');
    return t;
  };
})();