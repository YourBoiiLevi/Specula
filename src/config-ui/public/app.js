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
        if (f.type === 'number') val = Number(val);
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
    userDiv.innerHTML = `<label>Username</label><input type="text" id="auth-user" value="${currentConfig.configUiAuth?.user || ''}">`;
    
    const passDiv = document.createElement('div');
    passDiv.className = 'form-group';
    passDiv.innerHTML = `<label>Password</label><input type="password" id="auth-pass" value="${currentConfig.configUiAuth?.pass || ''}">`;
    
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
      header.innerHTML = `<span class="pipeline-id">${p.id}</span>`;
      
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
      els.validationBanner.innerHTML = errors.join('<br>');
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
        const errs = data.errors.map(e => `${e.path ? e.path + ': ' : ''}${e.message}`).join('<br>');
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
      els.statusTable.innerHTML = '<p>No status available.</p>';
      return;
    }

    let html = `<table>
      <thead>
        <tr>
          <th>Pipeline</th>
          <th>Status</th>
          <th>Last Run</th>
          <th>Items</th>
          <th>Model</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>`;
      
    pipelines.forEach(p => {
      const timeStr = p.lastRunAt ? new Date(p.lastRunAt).toLocaleString() : 'Never';
      const errHtml = p.lastError ? `<span class="error-text" title="${p.lastError.replace(/"/g, '&quot;')}">${p.lastError.substring(0, 120)}${p.lastError.length > 120 ? '...' : ''}</span>` : '';
      
      html += `<tr>
        <td><strong>${p.pipelineId}</strong></td>
        <td><span class="status-chip status-${p.lastRunStatus}">${p.lastRunStatus}</span>${errHtml}</td>
        <td>${timeStr}</td>
        <td>${p.lastItemCount !== undefined ? p.lastItemCount : '-'}</td>
        <td>${p.lastModelUsed || '-'}</td>
        <td><button type="button" onclick="window.runPipeline('${p.pipelineId}')">Run now</button></td>
      </tr>`;
    });
    
    html += `</tbody></table>`;
    els.statusTable.innerHTML = html;
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
