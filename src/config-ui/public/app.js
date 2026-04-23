'use strict';

(function() {
  let currentConfig = null;
  const FACTORS_OF_60 = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60];
  const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'];

  const els = {
    globalSettings: document.getElementById('global-settings-container'),
    pipelines: document.getElementById('pipelines-container'),
    addPipelineBtn: document.getElementById('add-pipeline'),
    statusTable: document.getElementById('status-table-container'),
    validationBanner: document.getElementById('validation-banner'),
    saveBtn: document.getElementById('save-button'),
    pipelineCountBadge: document.getElementById('pipeline-count-badge'),
  };

  async function init() {
    try {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error('Failed to load config');
      const data = await res.json();
      currentConfig = data.config;
      render();
      validate();
      
      els.addPipelineBtn.addEventListener('click', () => {
        const newId = `pipeline-${Date.now()}`;
        currentConfig.pipelines.push({
          id: newId,
          label: 'New Pipeline',
          description: '',
          feedGroups: [{ id: `fg-${Date.now()}`, label: 'Feed Group', url: '' }]
        });
        renderPipelines();
        validate();
      });

      els.saveBtn.addEventListener('click', save);

      fetchStatus();
      setInterval(fetchStatus, 10000);
    } catch (err) {
      console.error(err);
      els.validationBanner.textContent = 'Error loading config: ' + err.message;
      els.validationBanner.className = 'invalid';
    }
  }

  function render() {
    renderGlobalSettings();
    renderPipelines();
  }

  function renderGlobalSettings() {
    els.globalSettings.innerHTML = '';
    
    const fields = [
      { key: 'intervalHours', label: 'Interval Hours', type: 'number' },
      { key: 'primaryModel', label: 'Primary Model', type: 'text' },
      { key: 'fallbackModel', label: 'Fallback Model', type: 'text' },
      { key: 'thinkingLevel', label: 'Thinking Level', type: 'select', options: THINKING_LEVELS },
      { key: 'maxItemsPerRun', label: 'Max Items Per Run', type: 'number' },
      { key: 'dedupWindowHours', label: 'Dedup Window Hours', type: 'number' },
      { key: 'siteRepoPath', label: 'Site Repo Path', type: 'text' },
      { key: 'githubPagesUrl', label: 'GitHub Pages URL', type: 'text' },
      { key: 'feedTitle', label: 'Feed Title', type: 'text' },
      { key: 'feedDescription', label: 'Feed Description', type: 'text' },
      { key: 'configUiPort', label: 'Config UI Port', type: 'number' },
    ];

    fields.forEach(f => {
      const div = document.createElement('div');
      div.className = 'form-group';
      
      const label = document.createElement('label');
      label.textContent = f.label;
      div.appendChild(label);

      let input;
      if (f.type === 'select') {
        input = document.createElement('select');
        f.options.forEach(opt => {
          const option = document.createElement('option');
          option.value = opt;
          option.textContent = opt;
          if (currentConfig[f.key] === opt) option.selected = true;
          input.appendChild(option);
        });
      } else {
        input = document.createElement('input');
        input.type = f.type;
        input.value = currentConfig[f.key] || '';
      }
      
      input.dataset.key = f.key;
      input.addEventListener('input', () => {
        let val = input.value;
        if (f.type === 'number') {
          // Empty input must not silently become 0 — let the value go through
          // as empty so validate()/server-side validation flags it. Blank ≠
          // zero.
          val = input.value === '' ? '' : Number(input.value);
        }
        currentConfig[f.key] = val;
        validate();
      });
      
      div.appendChild(input);
      els.globalSettings.appendChild(div);
    });

    // Auth
    const authDetails = document.createElement('details');
    const authSummary = document.createElement('summary');
    authSummary.textContent = 'Config UI Auth';
    authDetails.appendChild(authSummary);

    const authDiv = document.createElement('div');
    authDiv.style.marginTop = '1rem';
    
    const userDiv = document.createElement('div');
    userDiv.className = 'form-group';
    const userLabel = document.createElement('label');
    userLabel.textContent = 'Username';
    const userInput = document.createElement('input');
    userInput.type = 'text';
    userInput.id = 'auth-user';
    userInput.value = currentConfig.configUiAuth?.user || '';
    userDiv.appendChild(userLabel);
    userDiv.appendChild(userInput);

    const passDiv = document.createElement('div');
    passDiv.className = 'form-group';
    const passLabel = document.createElement('label');
    passLabel.textContent = 'Password';
    const passInput = document.createElement('input');
    passInput.type = 'password';
    passInput.id = 'auth-pass';
    passInput.value = currentConfig.configUiAuth?.pass || '';
    passDiv.appendChild(passLabel);
    passDiv.appendChild(passInput);
    
    const disableBtn = document.createElement('button');
    disableBtn.textContent = 'Disable Auth';
    disableBtn.type = 'button';
    disableBtn.className = 'danger';
    
    authDiv.appendChild(userDiv);
    authDiv.appendChild(passDiv);
    authDiv.appendChild(disableBtn);
    authDetails.appendChild(authDiv);
    els.globalSettings.appendChild(authDetails);

    const userIn = authDiv.querySelector('#auth-user');
    const passIn = authDiv.querySelector('#auth-pass');
    
    const updateAuth = () => {
      if (userIn.value || passIn.value) {
        currentConfig.configUiAuth = { user: userIn.value, pass: passIn.value };
      } else {
        delete currentConfig.configUiAuth;
      }
      validate();
    };
    
    userIn.addEventListener('input', updateAuth);
    passIn.addEventListener('input', updateAuth);
    
    disableBtn.addEventListener('click', () => {
      userIn.value = '';
      passIn.value = '';
      updateAuth();
    });
  }

  function renderPipelines() {
    els.pipelines.innerHTML = '';
    els.pipelineCountBadge.textContent = `(${currentConfig.pipelines.length})`;
    
    currentConfig.pipelines.forEach((p, pIdx) => {
      const card = document.createElement('div');
      card.className = 'pipeline-card';
      
      const header = document.createElement('div');
      header.className = 'pipeline-header';
      const pidSpan = document.createElement('span');
      pidSpan.className = 'pipeline-id';
      pidSpan.textContent = p.id;
      header.appendChild(pidSpan);
      
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Delete Pipeline';
      delBtn.className = 'danger';
      delBtn.onclick = () => {
        currentConfig.pipelines.splice(pIdx, 1);
        renderPipelines();
        validate();
      };
      header.appendChild(delBtn);
      card.appendChild(header);

      // Label
      card.appendChild(createInputGroup('Label', 'text', p.label, val => { p.label = val; validate(); }));
      // Description
      card.appendChild(createTextareaGroup('Description', p.description, val => { p.description = val; validate(); }));
      // Focus Instructions
      card.appendChild(createTextareaGroup('Focus Instructions (optional)', p.focusInstructions || '', val => { p.focusInstructions = val || undefined; validate(); }));
      // Max Items
      card.appendChild(createInputGroup('Max Items Per Run (optional)', 'number', p.maxItemsPerRun || '', val => { p.maxItemsPerRun = val ? Number(val) : undefined; validate(); }));
      // Model Tier
      const tierDiv = document.createElement('div');
      tierDiv.className = 'form-group';
      tierDiv.innerHTML = `<label>Model Tier</label>
        <select>
          <option value="primary" ${p.modelTier !== 'fallback' ? 'selected' : ''}>Primary</option>
          <option value="fallback" ${p.modelTier === 'fallback' ? 'selected' : ''}>Fallback</option>
        </select>`;
      tierDiv.querySelector('select').addEventListener('change', e => {
        p.modelTier = e.target.value;
        validate();
      });
      card.appendChild(tierDiv);

      // Feed Groups
      const fgContainer = document.createElement('div');
      fgContainer.innerHTML = `<h4>Feed Groups</h4>`;
      
      p.feedGroups.forEach((fg, fgIdx) => {
        const row = document.createElement('div');
        row.className = 'feed-group-row';
        
        row.appendChild(createInputGroup('ID', 'text', fg.id, val => { fg.id = val; validate(); }));
        row.appendChild(createInputGroup('Label', 'text', fg.label, val => { fg.label = val; validate(); }));
        row.appendChild(createInputGroup('URL', 'text', fg.url, val => { fg.url = val; validate(); }));
        
        const delFgBtn = document.createElement('button');
        delFgBtn.textContent = 'X';
        delFgBtn.className = 'danger';
        delFgBtn.onclick = () => {
          p.feedGroups.splice(fgIdx, 1);
          renderPipelines();
          validate();
        };
        row.appendChild(delFgBtn);
        fgContainer.appendChild(row);
      });

      const addFgBtn = document.createElement('button');
      addFgBtn.textContent = '+ Add feed group';
      addFgBtn.type = 'button';
      addFgBtn.onclick = () => {
        p.feedGroups.push({ id: `fg-${Date.now()}`, label: 'New Feed', url: '' });
        renderPipelines();
        validate();
      };
      fgContainer.appendChild(addFgBtn);
      
      card.appendChild(fgContainer);
      els.pipelines.appendChild(card);
    });
  }

  function createInputGroup(labelTxt, type, val, onChange) {
    const div = document.createElement('div');
    div.className = 'form-group';
    const label = document.createElement('label');
    label.textContent = labelTxt;
    const input = document.createElement('input');
    input.type = type;
    input.value = val;
    input.addEventListener('input', e => onChange(e.target.value));
    div.appendChild(label);
    div.appendChild(input);
    return div;
  }

  function createTextareaGroup(labelTxt, val, onChange) {
    const div = document.createElement('div');
    div.className = 'form-group';
    const label = document.createElement('label');
    label.textContent = labelTxt;
    const input = document.createElement('textarea');
    input.value = val;
    input.addEventListener('input', e => onChange(e.target.value));
    div.appendChild(label);
    div.appendChild(input);
    return div;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function validate() {
    const errors = [];
    
    if (!FACTORS_OF_60.includes(currentConfig.pipelines.length)) {
      errors.push(`Pipeline count (${currentConfig.pipelines.length}) must be a factor of 60: ${FACTORS_OF_60.join(', ')}`);
    }

    const pIds = new Set();
    currentConfig.pipelines.forEach(p => {
      if (pIds.has(p.id)) errors.push(`Duplicate pipeline ID: ${p.id}`);
      pIds.add(p.id);
      
      const fgIds = new Set();
      p.feedGroups.forEach(fg => {
        if (fgIds.has(fg.id)) errors.push(`Duplicate feed group ID '${fg.id}' in pipeline '${p.id}'`);
        fgIds.add(fg.id);
      });
    });

    if (errors.length > 0) {
      els.validationBanner.innerHTML = errors.map(escapeHtml).join('<br>');
      els.validationBanner.className = 'invalid';
      els.saveBtn.disabled = true;
    } else {
      els.validationBanner.textContent = 'Configuration is valid.';
      els.validationBanner.className = 'valid';
      els.saveBtn.disabled = false;
    }
  }

  async function save() {
    els.saveBtn.disabled = true;
    els.saveBtn.textContent = 'Saving...';
    
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentConfig)
      });
      
      const data = await res.json();
      if (res.ok) {
        els.validationBanner.textContent = 'Saved successfully!';
        els.validationBanner.className = 'valid';
        setTimeout(() => {
          if (els.validationBanner.textContent === 'Saved successfully!') {
            validate();
          }
        }, 3000);
      } else {
        const errs = data.errors
          .map(e => `${e.path ? e.path + ': ' : ''}${e.message}`)
          .map(escapeHtml)
          .join('<br>');
        els.validationBanner.innerHTML = errs;
        els.validationBanner.className = 'invalid';
      }
    } catch (err) {
      els.validationBanner.textContent = 'Network error: ' + err.message;
      els.validationBanner.className = 'invalid';
    } finally {
      els.saveBtn.disabled = false;
      els.saveBtn.textContent = 'Save configuration';
    }
  }

  async function fetchStatus() {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) return;
      const data = await res.json();
      renderStatusTable(data.pipelines);
    } catch (err) {
      console.error('Failed to fetch status', err);
    }
  }

  function renderStatusTable(pipelines) {
    if (!pipelines || pipelines.length === 0) {
      els.statusTable.textContent = '';
      const p = document.createElement('p');
      p.textContent = 'No status available.';
      els.statusTable.appendChild(p);
      return;
    }

    // Build the table via the DOM API so user-controlled values (pipelineId,
    // lastError, lastModelUsed, etc.) can't break out into script/html tags.
    els.statusTable.textContent = '';
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['Pipeline', 'Status', 'Last Run', 'Items', 'Model', 'Action'].forEach(label => {
      const th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    pipelines.forEach(p => {
      const tr = document.createElement('tr');

      const pidCell = document.createElement('td');
      const strong = document.createElement('strong');
      strong.textContent = p.pipelineId;
      pidCell.appendChild(strong);
      tr.appendChild(pidCell);

      const statusCell = document.createElement('td');
      const chip = document.createElement('span');
      chip.className = 'status-chip status-' + String(p.lastRunStatus || 'idle').replace(/[^a-z]/gi, '');
      chip.textContent = p.lastRunStatus || 'idle';
      statusCell.appendChild(chip);
      if (p.lastError) {
        const errSpan = document.createElement('span');
        errSpan.className = 'error-text';
        errSpan.title = p.lastError;
        errSpan.textContent = ' ' + (p.lastError.length > 120 ? p.lastError.substring(0, 120) + '…' : p.lastError);
        statusCell.appendChild(errSpan);
      }
      tr.appendChild(statusCell);

      const timeCell = document.createElement('td');
      timeCell.textContent = p.lastRunAt ? new Date(p.lastRunAt).toLocaleString() : 'Never';
      tr.appendChild(timeCell);

      const itemsCell = document.createElement('td');
      itemsCell.textContent = p.lastItemCount !== undefined ? String(p.lastItemCount) : '-';
      tr.appendChild(itemsCell);

      const modelCell = document.createElement('td');
      modelCell.textContent = p.lastModelUsed || '-';
      tr.appendChild(modelCell);

      const actionCell = document.createElement('td');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Run now';
      btn.addEventListener('click', () => window.runPipeline(p.pipelineId));
      actionCell.appendChild(btn);
      tr.appendChild(actionCell);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    els.statusTable.appendChild(table);
  }

  window.runPipeline = async function(id) {
    try {
      const res = await fetch(`/api/run/${id}`, { method: 'POST' });
      if (res.ok) {
        alert(`Pipeline ${id} run accepted.`);
        fetchStatus();
      } else {
        const data = await res.json();
        alert(`Error: ${data.error}`);
      }
    } catch (err) {
      alert(`Network error: ${err.message}`);
    }
  };

  document.addEventListener('DOMContentLoaded', init);
})();
