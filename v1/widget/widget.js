var state = {
	preset                 : 'last_60_days',
	customDays             : 14,
	customMonths           : 6,
	tableVisible           : true,
	debugVisible           : false,
	generating             : false,
	observedDensityPerHour : null,
	observedSeriesCount    : null
};

function observeDensity() {
	try {
		var sub = self.ctx.defaultSubscription;
		if (!sub || !sub.data || !sub.data.length) return;
		var totalPoints = 0, minTs = Infinity, maxTs = -Infinity;
		sub.data.forEach(function (series) {
			if (!series.data || !series.data.length) return;
			totalPoints += series.data.length;
			series.data.forEach(function (pt) {
				if (pt[0] < minTs) minTs = pt[0];
				if (pt[0] > maxTs) maxTs = pt[0];
			});
		});
		var spanHours = (maxTs - minTs) / 3600000;
		if (spanHours < 0.1 || !sub.data.length) return;
		state.observedSeriesCount    = sub.data.length;
		state.observedDensityPerHour = (totalPoints / sub.data.length) / spanHours;
	} catch (e) {}
}

self.onInit = function () {

	var cfg = {
		apiUrl              : window.location.origin + '/api/pivot-excel/v1',
		tenantId            : (self.ctx.currentUser || {}).tenantId || '',
		defaultPreset       : 'last_60_days',
		customDays          : 14,
		customMonths        : 6,
		defaultPageSize     : 30,
		reportConfig        : {},
		showTable           : true,
		showDebug           : false,
		filename            : 'tb_pivot_export',
		filenameRange       : true,
		filenameTimestamp   : true,
		aggDefault          : 'mean',
		weekStart           : 'Sunday',
		partialPeriod       : false,
		safeLimit           : 40000,
		fallbackDensity     : 60
	};

	var s = (self.ctx || {}).settings || {};

	if (s.defaultReportRange)          cfg.defaultPreset     = s.defaultReportRange;
	if (s.customDays)                  cfg.customDays        = s.customDays;
	if (s.customMonths)                cfg.customMonths      = s.customMonths;
	if (s.defaultPageSize)             cfg.defaultPageSize   = s.defaultPageSize;
	if (s.showTable      != null)      cfg.showTable         = s.showTable;
	if (s.showDebug      != null)      cfg.showDebug         = s.showDebug;
	if (s.filename && s.filename.trim()) cfg.filename        = s.filename.trim().replace(/\.xlsx$/i, '');
	if (s.filenameRange  != null)      cfg.filenameRange     = s.filenameRange;
	if (s.filenameTimestamp != null)   cfg.filenameTimestamp = s.filenameTimestamp;
	if (s.aggDefault)                  cfg.aggDefault        = s.aggDefault;
	if (s.weekStart)                   cfg.weekStart         = s.weekStart;
	if (s.partialPeriod  != null)      cfg.partialPeriod     = s.partialPeriod;
	if (s.fallbackDensity)             cfg.fallbackDensity   = s.fallbackDensity;

	var baseReportConfig = {
		filename           : cfg.filename,
		filename_timestamp : cfg.filenameTimestamp,
		agg_map            : { default: cfg.aggDefault },
		sheets             : { week_start: cfg.weekStart, partial_period: cfg.partialPeriod }
	};

	if (s.reportConfig) {
		try {
			var override = JSON.parse(s.reportConfig);
			cfg.reportConfig = Object.assign({}, baseReportConfig, override);
			if (override.agg_map) cfg.reportConfig.agg_map = Object.assign({}, baseReportConfig.agg_map, override.agg_map);
			if (override.sheets)  cfg.reportConfig.sheets  = Object.assign({}, baseReportConfig.sheets,  override.sheets);
		} catch (e) { cfg.reportConfig = baseReportConfig; }
	} else {
		cfg.reportConfig = baseReportConfig;
	}

	state.preset       = cfg.defaultPreset;
	state.customDays   = cfg.customDays;
	state.customMonths = cfg.customMonths;
	state.tableVisible = cfg.showTable;
	state.debugVisible = cfg.showDebug;


	// ── Time helpers ──────────────────────────────────────────────────────────────

	function monthStart(y, m) { return new Date(y, m, 1, 0, 0, 0, 0).getTime(); }
	function yearStart(y)     { return new Date(y, 0, 1, 0, 0, 0, 0).getTime(); }
	function daysAgo(ts, d)   { return ts - d * 86400000; }

	function computeRange(preset) {
		var now       = new Date();
		var end       = now.getTime();
		var y         = now.getFullYear();
		var m         = now.getMonth();
		var thisMonth = monthStart(y, m);

		var fixed = {
			last_24_hours : { label: 'Last 24 hours', startTs: daysAgo(end, 1),  endTs: end },
			last_7_days   : { label: 'Last 7 days',   startTs: daysAgo(end, 7),  endTs: end },
			last_30_days  : { label: 'Last 30 days',  startTs: daysAgo(end, 30), endTs: end },
			last_60_days  : { label: 'Last 60 days',  startTs: daysAgo(end, 60), endTs: end },
			this_year     : { label: 'This year',     startTs: yearStart(y),     endTs: end },
			last_year     : { label: 'Last year',     startTs: yearStart(y - 1), endTs: yearStart(y) - 1 }
		};

		if (fixed[preset]) return fixed[preset];

		if (preset === 'custom_days') {
			var d = state.customDays || 14;
			return { label: 'Last ' + d + ' days', startTs: daysAgo(end, d), endTs: end };
		}
		if (preset === 'last_month') {
			var pm = m - 1 < 0 ? 11 : m - 1;
			var py = m - 1 < 0 ? y - 1 : y;
			return { label: 'Last month', startTs: monthStart(py, pm), endTs: thisMonth - 1 };
		}
		if (preset === 'last_3_months') {
			var sm3 = m - 3, sy3 = y;
			while (sm3 < 0) { sm3 += 12; sy3--; }
			return { label: 'Last 3 months', startTs: monthStart(sy3, sm3), endTs: thisMonth - 1 };
		}
		if (preset === 'custom_months') {
			var mo = state.customMonths || 6;
			var sm = m - mo, sy = y;
			while (sm < 0) { sm += 12; sy--; }
			return { label: 'Last ' + mo + ' months', startTs: monthStart(sy, sm), endTs: thisMonth - 1 };
		}
		return { label: 'Last 60 days', startTs: daysAgo(end, 60), endTs: end };
	}


	// ── Auto aggregation ──────────────────────────────────────────────────────────

	function snapToHour(ts) {
		var d = new Date(ts);
		return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), 0, 0, 0).getTime();
	}

	function snapToDay(ts) {
		var d = new Date(ts);
		return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
	}

	function resolveAgg(range) {
		if (s.reportConfig) {
			try {
				var ov = JSON.parse(s.reportConfig);
				if (ov.query && (ov.query.agg || ov.query.interval)) {
					return { query: Object.assign({ limit: 50000, order: 'ASC' }, ov.query), startTs: range.startTs, source: 'override' };
				}
			} catch (e) {}
		}

		var series        = state.observedSeriesCount  || 1;
		var density       = state.observedDensityPerHour !== null ? state.observedDensityPerHour : cfg.fallbackDensity;
		var densitySource = state.observedDensityPerHour !== null ? 'observed' : 'fallback';

		var spanMs    = range.endTs - range.startTs;
		var spanHours = spanMs / 3600000;
		var spanDays  = spanMs / 86400000;

		var rawEst    = series * spanHours * density;
		var hourlyEst = series * spanHours;
		var dailyEst  = series * spanDays;

		var selected, query, snappedStart;

		if (rawEst <= cfg.safeLimit) {
			selected     = 'NONE (raw)';
			query        = { agg: 'NONE', limit: 50000, order: 'ASC' };
			snappedStart = range.startTs;
		} else if (hourlyEst <= cfg.safeLimit) {
			selected     = '1 hour';
			snappedStart = snapToHour(range.startTs);
			query        = { agg: 'AVG', interval: 3600000, limit: 50000, order: 'ASC' };
		} else {
			selected     = '1 day';
			snappedStart = snapToDay(range.startTs);
			query        = { agg: 'AVG', interval: 86400000, limit: 50000, order: 'ASC' };
		}

		return {
			query         : query,
			startTs       : snappedStart,
			originalStart : range.startTs,
			source        : densitySource,
			density       : density,
			series        : series,
			rawEst        : Math.round(rawEst),
			hourlyEst     : Math.round(hourlyEst),
			dailyEst      : Math.round(dailyEst),
			selected      : selected
		};
	}


	// ── Entity / key detection ────────────────────────────────────────────────────

	function detectKeys() {
		var keyMap = {};
		try {
			var datasources = self.ctx.defaultSubscription.datasources || self.ctx.datasources || [];
			datasources.forEach(function (ds) {
				if (ds.dataKeys) ds.dataKeys.forEach(function (k) { keyMap[k.name] = true; });
			});
		} catch (e) {}
		return Object.keys(keyMap);
	}

	function resolveEntities() {
		var map = {};
		try {
			self.ctx.datasources.forEach(function (ds) {
				var type, id;
				if (ds.entity) {
					type = typeof ds.entity.id === 'string' ? ds.entity.entityType : ds.entity.id.entityType;
					id   = typeof ds.entity.id === 'string' ? ds.entity.id         : ds.entity.id.id;
				}
				if (!id && ds.entityId) { type = ds.entityId.entityType; id = ds.entityId.id; }
				if (id) {
					map[(type || '') + ':' + id] = {
						type : (type || 'ASSET').toUpperCase(),
						id   : id,
						name : ds.entityName || ds.entityLabel || id
					};
				}
			});
		} catch (e) {}
		return Object.keys(map).map(function (k) { return map[k]; });
	}

	function updateCounts() {
		var entities = resolveEntities();
		var keys     = detectKeys();
		el('assetCount').textContent = entities.length;
		el('keyCount').textContent   = keys.length;
		return { entities: entities, keys: keys };
	}


	// ── Payload ───────────────────────────────────────────────────────────────────

	function buildPayload(range) {
		var data = updateCounts();
		var agg  = resolveAgg(range);
		return {
			_autoAgg     : agg,
			tenant_id    : cfg.tenantId,
			timezone     : 'Asia/Bangkok',
			timeEpoch    : { startTs_ms: agg.startTs, endTs_ms: range.endTs },
			entities     : data.entities,
			keys         : data.keys,
			query        : agg.query,
			reportConfig : cfg.reportConfig
		};
	}


	// ── DOM helper ────────────────────────────────────────────────────────────────

	function el(id) { return document.getElementById(id) || {}; }


	// ── Panel visibility ──────────────────────────────────────────────────────────

	function renderToggleBtn(btn, visible, label, activeColor) {
		btn.textContent      = (visible ? '▼ ' : '► ') + label;
		btn.style.background = visible ? activeColor : '#999';
		btn.style.color      = 'white';
	}

	function applyPanelLayout() {
		var bothVisible = state.tableVisible && state.debugVisible && cfg.showTable && cfg.showDebug;
		el('tablePanel').style.flex = bothVisible ? '1' : '1';
		el('debugPanel').style.flex = bothVisible ? '1' : 'none';
	}

	function applyTableVisibility() {
		var btn   = el('toggleTableBtn');
		var panel = el('tablePanel');
		if (!cfg.showTable) { btn.style.display = 'none'; panel.style.display = 'none'; return; }
		btn.style.display   = 'inline-block';
		panel.style.display = state.tableVisible ? 'flex' : 'none';
		renderToggleBtn(btn, state.tableVisible, 'Timeseries Table', '#1976d2');
		applyPanelLayout();
	}

	function applyDebugVisibility() {
		var btn   = el('toggleDebugBtn');
		var panel = el('debugPanel');
		if (!cfg.showDebug) { btn.style.display = 'none'; panel.style.display = 'none'; return; }
		btn.style.display   = 'inline-block';
		panel.style.display = state.debugVisible ? 'flex' : 'none';
		renderToggleBtn(btn, state.debugVisible, 'Debug', '#d32f2f');
		if (state.debugVisible) renderDebug();
		applyPanelLayout();
	}

	function applyToggleRowVisibility() {
		el('toggleRow').style.display = (cfg.showTable || cfg.showDebug) ? 'flex' : 'none';
	}

	function applyAllVisibility() {
		applyTableVisibility();
		applyDebugVisibility();
		applyToggleRowVisibility();
		self.onResize();
	}

	function toggleTable() { state.tableVisible = !state.tableVisible; applyTableVisibility(); }
	function toggleDebug() { state.debugVisible = !state.debugVisible; applyDebugVisibility(); }


	// ── Debug ─────────────────────────────────────────────────────────────────────

	function renderDebug(extra) {
		var r   = computeRange(state.preset);
		var agg = resolveAgg(r);
		var ts  = function (t) { return new Date(t).toISOString().replace('T', ' ').slice(0, 19) + 'Z'; };

		var data         = updateCounts();
		var cleanPayload = {
			tenant_id    : cfg.tenantId,
			timezone     : 'Asia/Bangkok',
			timeEpoch    : { startTs_ms: agg.startTs, endTs_ms: r.endTs },
			entities     : data.entities,
			keys         : data.keys,
			query        : agg.query,
			reportConfig : cfg.reportConfig
		};

		el('debugText').textContent =
			(extra ? extra + '\n' : '') +
			'\n=== SELECTION ===\n' +
			'Preset: '        + state.preset        + '\n' +
			'Custom days: '   + state.customDays    + '\n' +
			'Custom months: ' + state.customMonths  + '\n' +
			'Page size: '     + cfg.defaultPageSize + '\n' +
			'\n=== FILENAME ===\n' +
			'Base: '              + cfg.filename          + '\n' +
			'Append range: '      + cfg.filenameRange     + '\n' +
			'Append timestamp: '  + cfg.filenameTimestamp + '\n' +
			'Preview: '           + resolveFilename(r)    + '\n' +
			'\n=== REPORT CONFIG ===\n' +
			'Filename: '         + cfg.reportConfig.filename                        + '\n' +
			'Timestamp suffix: ' + cfg.reportConfig.filename_timestamp              + '\n' +
			'Agg default: '      + (cfg.reportConfig.agg_map || {}).default         + '\n' +
			'Week start: '       + ((cfg.reportConfig.sheets || {}).week_start)     + '\n' +
			'Partial period: '   + ((cfg.reportConfig.sheets || {}).partial_period) + '\n' +
			'Observed density: ' + (state.observedDensityPerHour !== null
				? state.observedDensityPerHour.toFixed(1) + ' rec/key/hr'
				: 'not yet observed') + '\n' +
			'\n=== AUTO AGG ===\n' +
			'Series count: '    + (agg.series    || '-') + '\n' +
			'Density source: '  + (agg.source    || '-') + '\n' +
			'Density used: '    + (agg.density   != null ? agg.density.toFixed(1) + ' rec/key/hr' : '-') + '\n' +
			'Est raw: '         + (agg.rawEst    || '-') + '\n' +
			'Est hourly: '      + (agg.hourlyEst || '-') + '\n' +
			'Est daily: '       + (agg.dailyEst  || '-') + '\n' +
			'Safe limit: '      + cfg.safeLimit           + '\n' +
			'Selected: '        + (agg.selected  || '-') + '\n' +
			'Snapped startTs: ' + (agg.originalStart !== agg.startTs
				? ts(agg.startTs) + '  (was ' + ts(agg.originalStart) + ')'
				: ts(agg.startTs) + '  (no snap needed)') + '\n' +
			'\n=== TIME RANGE ===\n' +
			'Label: ' + r.label                              + '\n' +
			'Start: ' + ts(r.startTs) + ' (' + r.startTs + ')\n' +
			'End:   ' + ts(r.endTs)   + ' (' + r.endTs   + ')\n' +
			'\n=== TENANT ===\n' +
			'Tenant ID: ' + cfg.tenantId + '\n' +
			'API URL:   ' + cfg.apiUrl   + '\n' +
			'\n=== PAYLOAD ===\n' +
			JSON.stringify(cleanPayload, null, 2);
	}

	function copyDebug() {
		var text = el('debugText').textContent;
		var btn  = el('copyDebugBtn');
		navigator.clipboard.writeText(text).then(function () {
			btn.textContent = 'Copied!'; btn.style.background = '#2e7d32';
			setTimeout(function () { btn.textContent = 'Copy'; btn.style.background = '#555'; }, 2000);
		}).catch(function () {
			btn.textContent = 'Failed';
			setTimeout(function () { btn.textContent = 'Copy'; }, 2000);
		});
	}


	// ── Export ────────────────────────────────────────────────────────────────────

	function setExportState(generating) {
		state.generating = generating;
		el('excelExportButton').textContent = generating ? 'Generating...' : 'Generate & Download Excel';
		el('excelExportButton').disabled    = generating;
	}

	function downloadBlob(blob, filename) {
		var url = window.URL.createObjectURL(blob);
		var a   = document.createElement('a');
		a.href = url; a.download = filename;
		document.body.appendChild(a); a.click();
		document.body.removeChild(a);
		window.URL.revokeObjectURL(url);
	}

	function resolveFilename(r) {
		// reportConfig JSON override takes priority
		if (s.reportConfig) {
			try {
				var ov = JSON.parse(s.reportConfig);
				if (ov.filename && ov.filename.trim())
					return ov.filename.trim().replace(/\.xlsx$/i, '') + '.xlsx';
			} catch (e) {}
		}

		var base      = (cfg.filename && cfg.filename.trim()) ? cfg.filename.trim() : '';
		var safeLabel = (r.label || 'Report').toLowerCase().replace(/\s+/g, '_').replace(/[\\\/:\*\?"<>\|]/g, '');

		// Build suffix parts
		var parts = [];
		if (base)                parts.push(base);
		if (cfg.filenameRange)   parts.push(safeLabel);
		if (cfg.filenameTimestamp) {
			var now = new Date();
			var pad = function (n) { return String(n).padStart(2, '0'); };
			var stamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) +
			            '_' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
			parts.push(stamp);
		}

		// Fallback: should never be empty, but just in case
		return (parts.length ? parts.join('_') : 'export') + '.xlsx';
	}

	function handleExport() {
		var statusEl = el('excelStatus');

		if (state.generating) { statusEl.textContent = 'Still generating… please wait.'; return; }
		if (!cfg.tenantId)    { statusEl.textContent = 'ERROR: Could not resolve tenant. Please refresh the page.'; return; }

		var r    = computeRange(state.preset);
		var agg  = resolveAgg(r);
		var data = updateCounts();

		if (!data.entities.length) { statusEl.textContent = 'ERROR: No entities resolved.'; return; }
		if (!data.keys.length)     { statusEl.textContent = 'ERROR: No keys found.';        return; }

		var sendPayload = {
			tenant_id    : cfg.tenantId,
			timezone     : 'Asia/Bangkok',
			timeEpoch    : { startTs_ms: agg.startTs, endTs_ms: r.endTs },
			entities     : data.entities,
			keys         : data.keys,
			query        : agg.query,
			reportConfig : cfg.reportConfig,
			debug        : cfg.showDebug
		};

		setExportState(true);
		statusEl.textContent = 'Generating report…';

		if (state.debugVisible) {
			renderDebug('=== EXPORT ===\nTimestamp: ' + new Date().toISOString() + '\nAPI: ' + cfg.apiUrl);
		}

		fetch(cfg.apiUrl, {
			method  : 'POST',
			headers : { 'Content-Type': 'application/json' },
			body    : JSON.stringify(sendPayload)
		})
			.then(function (resp) {
				if (!resp.ok) throw new Error('HTTP ' + resp.status + ' ' + resp.statusText);
				return resp.blob();
			})
			.then(function (blob) {
				downloadBlob(blob, resolveFilename(r));
				statusEl.textContent = '✓ Completed';
				setExportState(false);
			})
			.catch(function (err) {
				statusEl.textContent = 'ERROR: ' + err;
				if (state.debugVisible) el('debugText').textContent += '\n\n❌ ' + err;
				setExportState(false);
			});
	}


	// ── Init ──────────────────────────────────────────────────────────────────────

	setTimeout(function () {

		function clamp(val, min, max) {
			val = parseInt(val);
			return isNaN(val) ? min : Math.min(Math.max(val, min), max);
		}

		var dropdown        = el('excelPresetDropdown');
		var customDaysCon   = el('customDaysContainer');
		var customMonthsCon = el('customMonthsContainer');
		var customDaysInp   = el('customDaysInput');
		var customMonthsInp = el('customMonthsInput');

		function updateCustomInputVisibility(preset) {
			customDaysCon.style.display   = preset === 'custom_days'   ? 'flex' : 'none';
			customMonthsCon.style.display = preset === 'custom_months' ? 'flex' : 'none';
		}

		dropdown.value        = state.preset;
		customDaysInp.value   = state.customDays;
		customMonthsInp.value = state.customMonths;
		updateCustomInputVisibility(state.preset);

		dropdown.addEventListener('change', function (e) {
			state.preset = e.target.value;
			updateCustomInputVisibility(state.preset);
			if (state.debugVisible) renderDebug();
		});

		customDaysInp.addEventListener('change', function (e) {
			state.customDays    = clamp(e.target.value, 1, 365);
			customDaysInp.value = state.customDays;
			if (state.debugVisible) renderDebug();
		});

		customMonthsInp.addEventListener('change', function (e) {
			state.customMonths    = clamp(e.target.value, 1, 24);
			customMonthsInp.value = state.customMonths;
			if (state.debugVisible) renderDebug();
		});

		el('excelExportButton').addEventListener('click', handleExport);
		el('toggleTableBtn').addEventListener('click', toggleTable);
		el('toggleDebugBtn').addEventListener('click', toggleDebug);
		el('copyDebugBtn').addEventListener('click', copyDebug);

		applyAllVisibility();
		updateCounts();

	}, 500);

};


self.onDataUpdated = function () {
	observeDensity();
	try { self.ctx.$scope.timeseriesTableWidget.onDataUpdated(); } catch (e) {}
};

self.onLatestDataUpdated = function () {
	observeDensity();
	try { self.ctx.$scope.timeseriesTableWidget.onLatestDataUpdated(); } catch (e) {}
};

self.onResize  = function () {};
self.onDestroy = function () {};

