// ============================================
// STATE
// ============================================
const state = {
    rawData: [],
    headers: [],
    comparisonFields: [], // [{name, gtCol, predCol}]
    supplierCols: [],
    imageCol: null,
    imageColFull: null,
    articleNameCol: null,
    articleNumberCol: null,
    cleanupRules: {
        ignore: [],  // [{field, value}]
        map: [],     // [{field, oldValue, newValue}]
        groups: [],  // [{field, groupName, values: [string]}]
        skipEmptyGt: []  // [fieldName] - skip comparison when gt is empty
    },
    currentPage: 1,
    pageSize: 25,
    filteredIndices: [],
    selectedRowIndex: null,
    heatmapFilter: null, // {fieldName, gtValue, predValue}
    _cleanedData: null,
    _metrics: null
};

let chartInstances = {};

// ============================================
// INITIALIZATION & FILE HANDLING
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('file-input');
    const uploadArea = document.getElementById('upload-area');

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleFile(e.target.files[0]);
    });

    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
});

function handleFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();

    document.getElementById('file-info').style.display = 'flex';
    document.getElementById('file-info').innerHTML =
        `<span>📄</span> <strong>${escapeHtml(file.name)}</strong> <span>(${(file.size / 1024).toFixed(1)} KB)</span>`;

    if (ext === 'csv') {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                processData(results.meta.fields, results.data);
            }
        });
    } else if (ext === 'xlsx' || ext === 'xls') {
        const reader = new FileReader();
        reader.onload = (e) => {
            const wb = XLSX.read(e.target.result, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(ws, { defval: '' });
            if (jsonData.length > 0) {
                processData(Object.keys(jsonData[0]), jsonData);
            }
        };
        reader.readAsArrayBuffer(file);
    }
}

function processData(headers, data) {
    state.headers = headers;
    state.rawData = data;

    // Detect comparison fields (gt_* paired with pred_*)
    state.comparisonFields = [];
    const gtPrefix = 'gt_';
    const predPrefix = 'pred_';

    headers.forEach(h => {
        if (h.startsWith(gtPrefix)) {
            const name = h.substring(gtPrefix.length);
            const predCol = predPrefix + name;
            if (headers.includes(predCol)) {
                state.comparisonFields.push({ name, gtCol: h, predCol });
            }
        }
    });

    // Supplier columns (everything not gt_ or pred_)
    state.supplierCols = headers.filter(h => !h.startsWith(gtPrefix) && !h.startsWith(predPrefix));

    // Detect special columns
    state.imageCol = headers.find(h => h.toLowerCase() === 'image_url') || null;
    state.imageColFull = headers.find(h => h.toLowerCase() === 'image_url_full') || null;
    state.articleNameCol = headers.find(h =>
        h.toLowerCase().includes('article') && h.toLowerCase().includes('name')
    ) || state.supplierCols[0] || null;
    state.articleNumberCol = headers.find(h =>
        h.toLowerCase().includes('article') && h.toLowerCase().includes('number')
    ) || null;

    // Show main content
    document.getElementById('main-content').style.display = 'block';

    // Populate dropdowns
    populateFieldDropdowns();

    // Initial render
    applyAndRefresh();
}

// ============================================
// FIELD DROPDOWNS & AUTOCOMPLETE
// ============================================
function populateFieldDropdowns() {
    const fields = state.comparisonFields;

    const ignoreField = document.getElementById('ignore-field');
    const mapField = document.getElementById('map-field');
    const groupField = document.getElementById('group-field');
    const fieldFilter = document.getElementById('field-filter');

    // Ignore & Map use gt column names
    [ignoreField, mapField].forEach(select => {
        select.innerHTML = '<option value="__all__">All Fields</option>';
        fields.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f.gtCol;
            opt.textContent = formatFieldName(f.name);
            select.appendChild(opt);
        });
    });

    // Skip empty GT field dropdown
    const skipEmptyField = document.getElementById('skipempty-field');
    skipEmptyField.innerHTML = '<option value="__all__">All Fields</option>';
    fields.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.name;
        opt.textContent = formatFieldName(f.name);
        skipEmptyField.appendChild(opt);
    });

    // Group uses comparison field name (applies to both gt and pred)
    groupField.innerHTML = '<option value="__all__">All Fields</option>';
    fields.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.name;
        opt.textContent = formatFieldName(f.name);
        groupField.appendChild(opt);
    });

    // Field filter for explorer
    fieldFilter.innerHTML = '<option value="all">All Fields</option>';
    fields.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.name;
        opt.textContent = formatFieldName(f.name);
        fieldFilter.appendChild(opt);
    });

    updateIgnoreValues();
    updateMapValues();
}

function updateIgnoreValues() {
    const field = document.getElementById('ignore-field').value;
    if (!field) return;
    const list = document.getElementById('ignore-values-list');
    list.innerHTML = '';
    if (field === '__all__') {
        const allVals = new Set();
        state.comparisonFields.forEach(f => getUniqueValues(f.gtCol).forEach(v => allVals.add(v)));
        [...allVals].sort().forEach(v => { const opt = document.createElement('option'); opt.value = v; list.appendChild(opt); });
    } else {
        getUniqueValues(field).forEach(v => { const opt = document.createElement('option'); opt.value = v; list.appendChild(opt); });
    }
}

function updateMapValues() {
    const field = document.getElementById('map-field').value;
    if (!field) return;
    const list = document.getElementById('map-old-list');
    list.innerHTML = '';
    if (field === '__all__') {
        const allVals = new Set();
        state.comparisonFields.forEach(f => getUniqueValues(f.gtCol).forEach(v => allVals.add(v)));
        [...allVals].sort().forEach(v => { const opt = document.createElement('option'); opt.value = v; list.appendChild(opt); });
    } else {
        getUniqueValues(field).forEach(v => { const opt = document.createElement('option'); opt.value = v; list.appendChild(opt); });
    }
}

function getUniqueValues(colName) {
    const vals = new Set();
    state.rawData.forEach(row => {
        const v = (row[colName] || '').toString().trim();
        if (v) vals.add(v);
    });
    return [...vals].sort();
}

// ============================================
// CLEANUP RULES
// ============================================
function addIgnoreRule() {
    const field = document.getElementById('ignore-field').value;
    const value = document.getElementById('ignore-value').value.trim();
    if (!field) return;
    if (!value) { alert('Please enter a value to ignore.'); return; }

    if (field === '__all__') {
        state.comparisonFields.forEach(f => {
            const exists = state.cleanupRules.ignore.some(
                r => r.field === f.gtCol && r.value.toLowerCase() === value.toLowerCase()
            );
            if (!exists) state.cleanupRules.ignore.push({ field: f.gtCol, value });
        });
    } else {
        state.cleanupRules.ignore.push({ field, value });
    }
    document.getElementById('ignore-value').value = '';
    renderRules();
}

function addMapRule() {
    const field = document.getElementById('map-field').value;
    const oldValue = document.getElementById('map-old').value.trim();
    const newValue = document.getElementById('map-new').value.trim();
    if (!field) return;
    if (!oldValue || !newValue) { alert('Please fill in both original and new values.'); return; }

    if (field === '__all__') {
        state.comparisonFields.forEach(f => {
            const exists = state.cleanupRules.map.some(
                r => r.field === f.gtCol && r.oldValue.toLowerCase() === oldValue.toLowerCase()
            );
            if (!exists) state.cleanupRules.map.push({ field: f.gtCol, oldValue, newValue });
        });
    } else {
        state.cleanupRules.map.push({ field, oldValue, newValue });
    }
    document.getElementById('map-old').value = '';
    document.getElementById('map-new').value = '';
    renderRules();
}

function addGroupRule() {
    const field = document.getElementById('group-field').value;
    const groupName = document.getElementById('group-name').value.trim();
    const valuesStr = document.getElementById('group-values').value.trim();
    if (!field) return;
    if (!groupName || !valuesStr) { alert('Please fill in group name and values.'); return; }

    const values = valuesStr.split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
    if (values.length < 2) { alert('Please enter at least 2 values for the group.'); return; }

    if (field === '__all__') {
        state.comparisonFields.forEach(f => {
            const exists = state.cleanupRules.groups.some(
                r => r.field === f.name && r.groupName === groupName
            );
            if (!exists) state.cleanupRules.groups.push({ field: f.name, groupName, values });
        });
    } else {
        state.cleanupRules.groups.push({ field, groupName, values });
    }
    document.getElementById('group-name').value = '';
    document.getElementById('group-values').value = '';
    renderRules();
}

function addSkipEmptyRule() {
    const field = document.getElementById('skipempty-field').value;
    if (!field) return;

    if (field === '__all__') {
        state.comparisonFields.forEach(f => {
            if (!state.cleanupRules.skipEmptyGt.includes(f.name)) {
                state.cleanupRules.skipEmptyGt.push(f.name);
            }
        });
    } else {
        if (state.cleanupRules.skipEmptyGt.includes(field)) {
            alert('This field is already added.'); return;
        }
        state.cleanupRules.skipEmptyGt.push(field);
    }
    renderRules();
}

function removeSkipEmptyRule(index) {
    state.cleanupRules.skipEmptyGt.splice(index, 1);
    renderRules();
}

function removeRule(type, index) {
    state.cleanupRules[type].splice(index, 1);
    renderRules();
}

function renderRules() {
    // Skip Empty GT rules
    document.getElementById('skipempty-rules').innerHTML = state.cleanupRules.skipEmptyGt.map((field, i) => `
        <div class="rule-item">
            <span class="rule-text">
                Skip comparison for <span class="rule-field">${formatFieldName(field)}</span> when GT is empty
            </span>
            <button class="btn-remove" onclick="removeSkipEmptyRule(${i})">✕ Remove</button>
        </div>
    `).join('');

    // Ignore rules
    document.getElementById('ignore-rules').innerHTML = state.cleanupRules.ignore.map((r, i) => `
        <div class="rule-item">
            <span class="rule-text">
                Ignore rows where <span class="rule-field">${formatFieldName(r.field)}</span>
                = <span class="rule-value">${escapeHtml(r.value)}</span>
            </span>
            <button class="btn-remove" onclick="removeRule('ignore', ${i})">✕ Remove</button>
        </div>
    `).join('');

    // Map rules
    document.getElementById('map-rules').innerHTML = state.cleanupRules.map.map((r, i) => `
        <div class="rule-item">
            <span class="rule-text">
                In <span class="rule-field">${formatFieldName(r.field)}</span>:
                <span class="rule-value">${escapeHtml(r.oldValue)}</span>
                <span class="rule-arrow">→</span>
                <span class="rule-value">${escapeHtml(r.newValue)}</span>
            </span>
            <button class="btn-remove" onclick="removeRule('map', ${i})">✕ Remove</button>
        </div>
    `).join('');

    // Group rules
    document.getElementById('group-rules').innerHTML = state.cleanupRules.groups.map((r, i) => `
        <div class="rule-item">
            <span class="rule-text">
                <span class="rule-field">${formatFieldName(r.field)}</span>:
                group "<strong>${escapeHtml(r.groupName)}</strong>" =
                ${r.values.map(v => `<span class="rule-value">${escapeHtml(v)}</span>`).join(', ')}
            </span>
            <button class="btn-remove" onclick="removeRule('groups', ${i})">✕ Remove</button>
        </div>
    `).join('');

    // Update badge count
    const total = state.cleanupRules.skipEmptyGt.length
        + state.cleanupRules.ignore.length
        + state.cleanupRules.map.length
        + state.cleanupRules.groups.length;
    document.getElementById('cleanup-badge').textContent = `${total} rule${total !== 1 ? 's' : ''}`;
}

// ============================================
// DATA PROCESSING
// ============================================
function getCleanedData() {
    let data = state.rawData.map(row => ({ ...row }));

    // 1. Apply map rules (transform gt values)
    for (const rule of state.cleanupRules.map) {
        data.forEach(row => {
            const val = (row[rule.field] || '').toString().trim();
            if (val.toLowerCase() === rule.oldValue.toLowerCase()) {
                row[rule.field] = rule.newValue;
            }
        });
    }

    // 2. Apply ignore rules (filter out rows)
    for (const rule of state.cleanupRules.ignore) {
        data = data.filter(row => {
            const val = (row[rule.field] || '').toString().trim().toLowerCase();
            return val !== rule.value.toLowerCase();
        });
    }

    return data;
}

function isMatch(gtValue, predValue, fieldName) {
    const gt = (gtValue || '').toString().trim().toLowerCase();
    const pred = (predValue || '').toString().trim().toLowerCase();

    if (gt === pred) return true;

    // Check group rules for this field
    for (const group of state.cleanupRules.groups) {
        if (group.field === fieldName) {
            if (group.values.includes(gt) && group.values.includes(pred)) {
                return true;
            }
        }
    }

    return false;
}

function computeMetrics(data) {
    const metrics = {};
    let totalCorrect = 0;
    let totalTotal = 0;

    for (const field of state.comparisonFields) {
        let correct = 0;
        let total = 0;
        const confusionMatrix = {};
        const gtValues = new Set();
        const predValues = new Set();

        const skipEmpty = state.cleanupRules.skipEmptyGt.includes(field.name);

        data.forEach(row => {
            const gt = (row[field.gtCol] || '').toString().trim().toLowerCase();
            const pred = (row[field.predCol] || '').toString().trim().toLowerCase();

            if (!gt && !pred) return;

            // Skip this field's comparison when GT is empty
            if (skipEmpty && !gt) return;

            total++;
            if (gt) gtValues.add(gt);
            if (pred) predValues.add(pred);

            if (isMatch(gt, pred, field.name)) correct++;

            // Build confusion matrix
            const gtKey = gt || '(empty)';
            const predKey = pred || '(empty)';
            if (!confusionMatrix[gtKey]) confusionMatrix[gtKey] = {};
            confusionMatrix[gtKey][predKey] = (confusionMatrix[gtKey][predKey] || 0) + 1;
        });

        totalCorrect += correct;
        totalTotal += total;

        metrics[field.name] = {
            correct,
            total,
            accuracy: total > 0 ? correct / total : 0,
            confusionMatrix,
            gtValues: [...gtValues].sort(),
            predValues: [...predValues].sort()
        };
    }

    metrics._overall = {
        correct: totalCorrect,
        total: totalTotal,
        accuracy: totalTotal > 0 ? totalCorrect / totalTotal : 0,
        fields: state.comparisonFields.length
    };

    return metrics;
}

// ============================================
// MASTER RENDER
// ============================================
function applyAndRefresh() {
    const cleanedData = getCleanedData();
    const metrics = computeMetrics(cleanedData);

    // Cache for table filtering
    state._cleanedData = cleanedData;
    state._metrics = metrics;

    renderSummary(metrics, cleanedData);
    renderCharts(metrics, cleanedData);
    renderDistributionCharts(metrics, cleanedData);
    renderHeatmaps(metrics);
    clearHeatmapFilter(true);
    renderDataTable(cleanedData, metrics);

    // Status message
    const ignored = state.rawData.length - cleanedData.length;
    showStatus(`✓ Applied. ${cleanedData.length} rows analyzed`
        + (ignored > 0 ? ` (${ignored} ignored)` : ''));
}

// ============================================
// SUMMARY CARDS
// ============================================
function renderSummary(metrics, cleanedData) {
    const container = document.getElementById('summary-cards');
    const overall = metrics._overall;

    let html = `
        <div class="summary-card info">
            <div class="card-value">${cleanedData.length}</div>
            <div class="card-label">Total Rows</div>
        </div>
        <div class="summary-card ${overall.accuracy >= 0.8 ? 'good' : overall.accuracy >= 0.5 ? '' : 'bad'}">
            <div class="card-value">${(overall.accuracy * 100).toFixed(1)}%</div>
            <div class="card-label">Overall Accuracy</div>
        </div>
    `;

    for (const field of state.comparisonFields) {
        const m = metrics[field.name];
        const cls = m.accuracy >= 0.8 ? 'good' : m.accuracy >= 0.5 ? '' : 'bad';
        html += `
            <div class="summary-card ${cls}">
                <div class="card-value">${(m.accuracy * 100).toFixed(1)}%</div>
                <div class="card-label">${formatFieldName(field.name)}</div>
            </div>
        `;
    }

    container.innerHTML = html;
}

// ============================================
// CHARTS
// ============================================
function renderCharts(metrics, cleanedData) {
    // Destroy existing chart instances
    if (chartInstances.accuracy) chartInstances.accuracy.destroy();
    if (chartInstances.overall) chartInstances.overall.destroy();

    const fields = state.comparisonFields.map(f => f.name);
    const accuracies = fields.map(f => +(metrics[f].accuracy * 100).toFixed(1));
    const colors = accuracies.map(a => a >= 80 ? '#10b981' : a >= 50 ? '#f59e0b' : '#ef4444');

    // Per-field accuracy bar chart
    const accCtx = document.getElementById('accuracy-chart').getContext('2d');
    chartInstances.accuracy = new Chart(accCtx, {
        type: 'bar',
        data: {
            labels: fields.map(f => formatFieldName(f)),
            datasets: [{
                label: 'Accuracy %',
                data: accuracies,
                backgroundColor: colors,
                borderRadius: 6,
                barPercentage: 0.6
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const fname = fields[ctx.dataIndex];
                            return `${ctx.parsed.y}% (${metrics[fname].correct}/${metrics[fname].total})`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: { callback: v => v + '%' }
                }
            }
        }
    });

    // Overall donut chart
    const overCtx = document.getElementById('overall-chart').getContext('2d');
    const overall = metrics._overall;
    chartInstances.overall = new Chart(overCtx, {
        type: 'doughnut',
        data: {
            labels: ['Correct', 'Incorrect'],
            datasets: [{
                data: [overall.correct, overall.total - overall.correct],
                backgroundColor: ['#10b981', '#ef4444'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            cutout: '65%',
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const pct = overall.total > 0
                                ? (ctx.parsed / overall.total * 100).toFixed(1) : 0;
                            return `${ctx.label}: ${ctx.parsed} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

// ============================================
// DISTRIBUTION CHARTS
// ============================================
function renderDistributionCharts(metrics, cleanedData) {
    const container = document.getElementById('distribution-charts');
    container.innerHTML = '';

    // Destroy old dist charts
    Object.keys(chartInstances).filter(k => k.startsWith('dist_')).forEach(k => {
        chartInstances[k].destroy();
        delete chartInstances[k];
    });

    state.comparisonFields.forEach(field => {
        const m = metrics[field.name];
        const allValues = [...new Set([...m.gtValues, ...m.predValues])].sort();

        const gtCounts = {};
        const predCounts = {};
        allValues.forEach(v => { gtCounts[v] = 0; predCounts[v] = 0; });

        cleanedData.forEach(row => {
            const gt = (row[field.gtCol] || '').toString().trim().toLowerCase();
            const pred = (row[field.predCol] || '').toString().trim().toLowerCase();
            if (gt && gtCounts[gt] !== undefined) gtCounts[gt]++;
            if (pred && predCounts[pred] !== undefined) predCounts[pred]++;
        });

        const card = document.createElement('div');
        card.className = 'dist-chart-card';
        const canvasId = `dist-${field.name}`;
        card.innerHTML = `<h4>${formatFieldName(field.name)}</h4><canvas id="${canvasId}"></canvas>`;
        container.appendChild(card);

        const ctx = document.getElementById(canvasId).getContext('2d');
        chartInstances[`dist_${field.name}`] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: allValues.map(v => v || '(empty)'),
                datasets: [
                    {
                        label: 'Ground Truth',
                        data: allValues.map(v => gtCounts[v] || 0),
                        backgroundColor: 'rgba(59, 130, 246, 0.7)',
                        borderRadius: 4
                    },
                    {
                        label: 'Predicted',
                        data: allValues.map(v => predCounts[v] || 0),
                        backgroundColor: 'rgba(139, 92, 246, 0.7)',
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                plugins: { legend: { position: 'top' } },
                scales: { y: { beginAtZero: true } }
            }
        });
    });
}

// ============================================
// HEATMAPS (CONFUSION MATRICES)
// ============================================
function renderHeatmaps(metrics) {
    const container = document.getElementById('heatmaps-container');
    container.innerHTML = '';

    state.comparisonFields.forEach(field => {
        const m = metrics[field.name];
        const cm = m.confusionMatrix;
        const allGt = Object.keys(cm).sort();
        const allPredSet = new Set();
        allGt.forEach(gt => Object.keys(cm[gt]).forEach(p => allPredSet.add(p)));
        const allPred = [...allPredSet].sort();

        if (allGt.length === 0 || allPred.length === 0) return;

        // Find max value for color scaling
        let maxVal = 0;
        allGt.forEach(gt => {
            allPred.forEach(pred => {
                const v = (cm[gt] && cm[gt][pred]) || 0;
                if (v > maxVal) maxVal = v;
            });
        });

        const card = document.createElement('div');
        card.className = 'heatmap-card';

        let html = `<div class="heatmap-toolbar">
            <h4>${formatFieldName(field.name)} — Confusion Matrix</h4>
            <button class="btn-fullscreen" onclick="openHeatmapFullscreen('${field.name}')">⛶ Fullscreen</button>
        </div>`;
        html += `<table class="heatmap-table" data-field="${field.name}">`;

        // Header row
        html += `<tr><th class="corner">GT ↓ &nbsp;/&nbsp; Pred →</th>`;
        allPred.forEach(v => {
            html += `<th>${escapeHtml(v)}</th>`;
        });
        html += `</tr>`;

        // Data rows
        allGt.forEach(gt => {
            html += `<tr><td class="row-header">${escapeHtml(gt)}</td>`;
            allPred.forEach(pred => {
                const count = (cm[gt] && cm[gt][pred]) || 0;
                const intensity = maxVal > 0 ? count / maxVal : 0;
                // Check if this cell is a "match" (diagonal or grouped)
                const isDiag = isMatch(gt === '(empty)' ? '' : gt, pred === '(empty)' ? '' : pred, field.name);

                let bgColor;
                if (count === 0) {
                    bgColor = 'transparent';
                } else if (isDiag) {
                    bgColor = `rgba(16, 185, 129, ${0.15 + intensity * 0.7})`;
                } else {
                    bgColor = `rgba(239, 68, 68, ${0.1 + intensity * 0.6})`;
                }
                const textColor = (count > 0 && intensity > 0.65) ? '#fff' : '#1a1a2e';

                html += `<td class="heatmap-cell" style="background:${bgColor}; color:${textColor}"
                    onclick="filterByHeatmapCell('${field.name}', '${escapeHtml(gt)}', '${escapeHtml(pred)}')">`;
                if (count > 0) {
                    const pct = m.total > 0 ? (count / m.total * 100).toFixed(1) : 0;
                    html += `<span class="cell-count">${count}</span><span class="cell-pct">${pct}%</span>`;
                }
                html += `</td>`;
            });
            html += `</tr>`;
        });

        html += `</table>`;
        html += `<p class="heatmap-legend"><span style="color:#10b981">■</span> Match &nbsp;&nbsp; <span style="color:#ef4444">■</span> Mismatch</p>`;

        card.innerHTML = html;
        container.appendChild(card);
    });
}

// ============================================
// DATA TABLE
// ============================================
function renderDataTable(cleanedData, metrics) {
    filterTable();
}

function filterTable() {
    const cleanedData = state._cleanedData || getCleanedData();

    const searchTerm = (document.getElementById('search-input').value || '').toLowerCase();
    const matchFilter = document.getElementById('match-filter').value;
    const fieldFilter = document.getElementById('field-filter').value;
    const hf = state.heatmapFilter;

    // Render or remove heatmap filter banner
    let banner = document.getElementById('heatmap-filter-banner');
    if (hf) {
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'heatmap-filter-banner';
            banner.className = 'heatmap-filter-banner';
            const controls = document.querySelector('.explorer-controls');
            controls.parentElement.insertBefore(banner, controls);
        }
        banner.innerHTML = `<span class="banner-text">
            Showing rows where <strong>${formatFieldName(hf.fieldName)}</strong>:
            GT = <code>${escapeHtml(hf.gtValue)}</code>,
            Pred = <code>${escapeHtml(hf.predValue)}</code>
        </span>
        <button class="btn-clear-filter" onclick="clearHeatmapFilter()">✕ Clear Filter</button>`;
    } else if (banner) {
        banner.remove();
    }

    state.filteredIndices = [];

    cleanedData.forEach((row, idx) => {
        // Heatmap cell filter
        if (hf) {
            const field = state.comparisonFields.find(f => f.name === hf.fieldName);
            if (field) {
                const gt = (row[field.gtCol] || '').toString().trim().toLowerCase();
                const pred = (row[field.predCol] || '').toString().trim().toLowerCase();
                const hfGt = hf.gtValue === '(empty)' ? '' : hf.gtValue.toLowerCase();
                const hfPred = hf.predValue === '(empty)' ? '' : hf.predValue.toLowerCase();
                if (gt !== hfGt || pred !== hfPred) return;
            }
        }

        // Search filter
        if (searchTerm) {
            const name = (row[state.articleNameCol] || '').toString().toLowerCase();
            const num = (row[state.articleNumberCol] || '').toString().toLowerCase();
            if (!name.includes(searchTerm) && !num.includes(searchTerm)) return;
        }

        // Match/mismatch filter
        if (matchFilter !== 'all') {
            const fieldsToCheck = fieldFilter === 'all'
                ? state.comparisonFields
                : state.comparisonFields.filter(f => f.name === fieldFilter);

            let hasMismatch = false;
            fieldsToCheck.forEach(field => {
                const gt = (row[field.gtCol] || '').toString().trim().toLowerCase();
                const pred = (row[field.predCol] || '').toString().trim().toLowerCase();
                if (!isMatch(gt, pred, field.name)) hasMismatch = true;
            });

            if (matchFilter === 'match' && hasMismatch) return;
            if (matchFilter === 'mismatch' && !hasMismatch) return;
        }

        state.filteredIndices.push(idx);
    });

    document.getElementById('table-count').textContent =
        `${state.filteredIndices.length} of ${cleanedData.length} rows`;

    state.currentPage = 1;
    renderTablePage();
}

function renderTablePage() {
    const cleanedData = state._cleanedData || getCleanedData();
    const start = (state.currentPage - 1) * state.pageSize;
    const end = Math.min(start + state.pageSize, state.filteredIndices.length);
    const pageIndices = state.filteredIndices.slice(start, end);

    // Table header
    const thead = document.getElementById('table-head');
    let headerHtml = '<tr><th>#</th>';
    if (state.articleNameCol) headerHtml += '<th>Article Name</th>';
    if (state.articleNumberCol) headerHtml += '<th>Article Number</th>';
    state.comparisonFields.forEach(f => {
        headerHtml += `<th>${formatFieldName(f.name)}</th>`;
    });
    headerHtml += '</tr>';
    thead.innerHTML = headerHtml;

    // Table body
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';

    pageIndices.forEach(idx => {
        const row = cleanedData[idx];
        const tr = document.createElement('tr');
        if (state.selectedRowIndex === idx) tr.classList.add('selected');
        tr.onclick = () => showRowDetail(idx);

        let cellHtml = `<td>${idx + 1}</td>`;

        if (state.articleNameCol) {
            const name = (row[state.articleNameCol] || '').toString();
            cellHtml += `<td title="${escapeHtml(name)}">${escapeHtml(name.substring(0, 45))}</td>`;
        }
        if (state.articleNumberCol) {
            cellHtml += `<td>${escapeHtml((row[state.articleNumberCol] || '').toString())}</td>`;
        }

        state.comparisonFields.forEach(f => {
            const gt = (row[f.gtCol] || '').toString().trim();
            const pred = (row[f.predCol] || '').toString().trim();
            const skipped = state.cleanupRules.skipEmptyGt.includes(f.name) && !gt;
            const match = !skipped && isMatch(gt, pred, f.name);
            if (skipped) {
                cellHtml += `<td>
                    <span class="match-badge skipped">— Skipped</span>
                </td>`;
            } else {
                cellHtml += `<td>
                    <span class="match-badge ${match ? 'match' : 'mismatch'}">
                        ${match ? '✓' : '✗'} ${escapeHtml(gt)} ${match ? '=' : '≠'} ${escapeHtml(pred)}
                    </span>
                </td>`;
            }
        });

        tr.innerHTML = cellHtml;
        tbody.appendChild(tr);
    });

    renderPagination();
}

function renderPagination() {
    const total = state.filteredIndices.length;
    const totalPages = Math.ceil(total / state.pageSize);
    const container = document.getElementById('pagination');

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = `<button ${state.currentPage === 1 ? 'disabled' : ''} onclick="goToPage(${state.currentPage - 1})">← Prev</button>`;

    const maxButtons = 7;
    let startPage = Math.max(1, state.currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    if (endPage - startPage < maxButtons - 1) {
        startPage = Math.max(1, endPage - maxButtons + 1);
    }

    if (startPage > 1) {
        html += `<button onclick="goToPage(1)">1</button>`;
        if (startPage > 2) html += `<span class="page-info">…</span>`;
    }

    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="${i === state.currentPage ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) html += `<span class="page-info">…</span>`;
        html += `<button onclick="goToPage(${totalPages})">${totalPages}</button>`;
    }

    html += `<button ${state.currentPage === totalPages ? 'disabled' : ''} onclick="goToPage(${state.currentPage + 1})">Next →</button>`;
    html += `<span class="page-info">Page ${state.currentPage} of ${totalPages}</span>`;

    container.innerHTML = html;
}

function goToPage(page) {
    state.currentPage = page;
    renderTablePage();
    document.getElementById('data-table').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================
// ROW DETAIL PANEL
// ============================================
function showRowDetail(idx) {
    const cleanedData = state._cleanedData || getCleanedData();
    const row = cleanedData[idx];
    state.selectedRowIndex = idx;

    const panel = document.getElementById('detail-panel');
    panel.style.display = 'block';

    // Image
    const imageUrl = (row[state.imageColFull] || row[state.imageCol] || '').toString();
    let imageHtml;
    if (imageUrl && !imageUrl.startsWith('gs://')) {
        imageHtml = `<img src="${escapeHtml(imageUrl)}" alt="Product image"
            onerror="this.parentElement.innerHTML='<div class=\\'img-placeholder\\'>Image not available</div>'" />`;
    } else {
        imageHtml = `<div class="img-placeholder">No image available</div>`;
    }

    // Comparison table
    let compHtml = '<table><tr><th>Field</th><th>Ground Truth</th><th>Predicted</th><th>Result</th></tr>';
    state.comparisonFields.forEach(f => {
        const gt = (row[f.gtCol] || '').toString().trim();
        const pred = (row[f.predCol] || '').toString().trim();
        const skipped = state.cleanupRules.skipEmptyGt.includes(f.name) && !gt;
        const match = !skipped && isMatch(gt, pred, f.name);
        if (skipped) {
            compHtml += `<tr style="background: #f3f4f6;">
                <td><strong>${formatFieldName(f.name)}</strong></td>
                <td><em style="color:#999">empty</em></td>
                <td>${escapeHtml(pred) || '<em style="color:#999">empty</em>'}</td>
                <td style="color:#6b7280">— Skipped</td>
            </tr>`;
        } else {
            compHtml += `<tr class="${match ? 'match' : 'mismatch'}">
                <td><strong>${formatFieldName(f.name)}</strong></td>
                <td>${escapeHtml(gt) || '<em style="color:#999">empty</em>'}</td>
                <td>${escapeHtml(pred) || '<em style="color:#999">empty</em>'}</td>
                <td>${match ? '✓ Match' : '✗ Mismatch'}</td>
            </tr>`;
        }
    });
    compHtml += '</table>';

    // Supplier attributes
    let attrsHtml = '';
    state.supplierCols.forEach(col => {
        const val = (row[col] || '').toString();
        if (col === state.imageCol || col === state.imageColFull) return;
        attrsHtml += `<div class="attr-item">
            <span class="attr-label">${escapeHtml(col)}</span>
            <span class="attr-value">${escapeHtml(val.substring(0, 500)) || '—'}</span>
        </div>`;
    });

    const articleName = escapeHtml((row[state.articleNameCol] || 'Row ' + (idx + 1)).toString());
    const articleNum = escapeHtml((row[state.articleNumberCol] || '').toString());

    panel.innerHTML = `
        <button class="detail-close" onclick="closeDetail()">×</button>
        <div class="detail-grid">
            <div class="detail-image">${imageHtml}</div>
            <div class="detail-info">
                <h3>${articleName}</h3>
                <p class="detail-subtitle">${articleNum}</p>
                <div class="detail-comparison">${compHtml}</div>
                <details class="detail-attrs">
                    <summary>All Supplier Attributes (${state.supplierCols.length - (state.imageCol ? 1 : 0) - (state.imageColFull ? 1 : 0)})</summary>
                    <div class="attrs-grid">${attrsHtml}</div>
                </details>
            </div>
        </div>
    `;

    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    renderTablePage();
}

function closeDetail() {
    document.getElementById('detail-panel').style.display = 'none';
    state.selectedRowIndex = null;
    renderTablePage();
}

// ============================================
// CACHE RULES
// ============================================
const CACHE_KEY = 'diff-analyzer-cleanup-rules';

function cacheRules() {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(state.cleanupRules));
        showStatus('✓ Rules saved to browser cache.');
    } catch (e) {
        alert('Failed to save rules: ' + e.message);
    }
}

function loadCachedRules() {
    try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (!cached) { alert('No cached rules found.'); return; }
        const rules = JSON.parse(cached);
        state.cleanupRules.ignore = rules.ignore || [];
        state.cleanupRules.map = rules.map || [];
        state.cleanupRules.groups = rules.groups || [];
        state.cleanupRules.skipEmptyGt = rules.skipEmptyGt || [];
        renderRules();
        showStatus('✓ Rules loaded from cache. Click "Apply" to refresh.');
    } catch (e) {
        alert('Failed to load rules: ' + e.message);
    }
}

function clearCachedRules() {
    localStorage.removeItem(CACHE_KEY);
    showStatus('✓ Cache cleared.');
}

function showStatus(msg) {
    const status = document.getElementById('cleanup-status');
    status.textContent = msg;
    setTimeout(() => { status.textContent = ''; }, 5000);
}

// ============================================
// HEATMAP FULLSCREEN
// ============================================
function openHeatmapFullscreen(fieldName) {
    const card = document.querySelector(`.heatmap-card table[data-field="${fieldName}"]`);
    if (!card) return;

    const overlay = document.getElementById('heatmap-fullscreen-overlay');
    document.getElementById('fullscreen-title').textContent =
        formatFieldName(fieldName) + ' — Confusion Matrix';

    const content = document.getElementById('fullscreen-heatmap-content');
    content.innerHTML = card.parentElement.querySelector('table').outerHTML
        + card.parentElement.querySelector('.heatmap-legend').outerHTML;

    overlay.style.display = 'block';
    document.body.style.overflow = 'hidden';
}

function closeHeatmapFullscreen() {
    document.getElementById('heatmap-fullscreen-overlay').style.display = 'none';
    document.body.style.overflow = '';
}

// Close fullscreen with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const overlay = document.getElementById('heatmap-fullscreen-overlay');
        if (overlay && overlay.style.display === 'block') {
            closeHeatmapFullscreen();
        }
    }
});

// ============================================
// HEATMAP CELL → TABLE FILTER
// ============================================
function filterByHeatmapCell(fieldName, gtValue, predValue) {
    state.heatmapFilter = { fieldName, gtValue, predValue };

    // Open explorer section if collapsed
    const explorer = document.getElementById('explorer-section');
    if (explorer.classList.contains('collapsed')) {
        explorer.classList.remove('collapsed');
    }

    filterTable();

    // Scroll to the explorer
    document.getElementById('explorer-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function clearHeatmapFilter(silent) {
    state.heatmapFilter = null;
    if (!silent) filterTable();
}

// ============================================
// UI HELPERS
// ============================================
function toggleSection(sectionId) {
    document.getElementById(sectionId).classList.toggle('collapsed');
}

function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector(`.tab[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
}

function formatFieldName(name) {
    const clean = name.replace(/^(gt_|pred_)/, '');
    return clean.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
