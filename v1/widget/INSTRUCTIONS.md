# YIP - Timeseries table Excel report (Raw + Pivot)
**Widget version:** v1
**Backend:** `tb_pivot_excel/v1`

---

## Deployed on

| Instance | URL |
|---|---|
| LH Smart Home | smarthome.lh.co.th |
| YIP TB PE | tbpe.yipintsoi.net |

---

## How to install the widget in ThingsBoard

1. Go to **Widget Library** → create or edit a widget bundle.
2. Create a new widget of type **"Latest values"** (or re-open the existing one).
3. Set the widget name to: `YIP - Timeseries table Excel report (Raw + Pivot)`
4. Paste the contents of each file into the corresponding ThingsBoard tab:

| File | ThingsBoard tab |
|---|---|
| `widget.html` | HTML |
| `widget.js` | JavaScript |
| `schema.json` | Settings schema (JSON) |

5. Save the widget.

---

## Widget settings (schema.json)

Configure these in the widget's **Settings** panel when placing it on a dashboard.

| Setting | Type | Default | Description |
|---|---|---|---|
| `defaultReportRange` | select | `last_60_days` | Initial range shown in the dropdown |
| `customDays` | number | `14` | Days used when "Last XX days" is selected |
| `customMonths` | number | `6` | Months used when "Last XX months" is selected |
| `defaultPageSize` | number | `30` | Rows per page in the timeseries table |
| `showTable` | boolean | `true` | Show/hide the embedded timeseries table panel |
| `showDebug` | boolean | `false` | Show/hide the debug info panel; also appends a `_Config` sheet to the Excel output with the fully-resolved report config |
| `filename` | string | `tb_pivot_export` | Base name for the downloaded .xlsx file |
| `filenameRange` | boolean | `true` | Append the selected range label to the browser download filename (widget-side only; does not affect the server-side file) |
| `filenameTimestamp` | boolean | `true` | Append a datetime stamp to the browser download filename (widget-side only; does not affect the server-side file) |
| `aggDefault` | select | `mean` | Default aggregation for Daily/Weekly/Monthly/Yearly sheets |
| `weekStart` | select | `Sunday` | First day of week for the Weekly sheet |
| `partialPeriod` | boolean | `false` | Include incomplete periods in aggregated sheets. When `false`, a period is dropped if it extends beyond the data range **or** if the first data point is not exactly at midnight (partial first day). When `true`, all periods with any data are included. |
| `reportConfig` | textarea | *(empty)* | Advanced JSON override — see section below |

> **Timezone note:** The widget currently hardcodes `timezone: "Asia/Bangkok"` in the payload sent to the backend. There is no widget setting for this — to change the timezone, edit `widget.js` and replace the three `'Asia/Bangkok'` occurrences.

---

## Auto-aggregation

Before sending the request the widget estimates the total number of data points (`series × span_hours × density_per_hour`) and picks the TB API query tier automatically:

| Estimated points | Query sent |
|---|---|
| ≤ 40 000 | `agg: "NONE"` (raw data) |
| hourly estimate ≤ 40 000 | `agg: "AVG"`, 1-hour interval |
| otherwise | `agg: "AVG"`, 1-day interval |

When no prior data is available the widget assumes a density of **60 points/series/hour**. Both constants (`safeLimit = 40 000`, `fallbackDensity = 60`) are hardcoded in `widget.js`. To bypass auto-agg entirely, set `query` in `reportConfig` (see below).

The widget also includes a `_autoAgg` field in every payload containing the full decision details (series count, density, point estimates, selected tier). The backend ignores this field — it exists for diagnostics and is shown in the widget's **Show Debug Panel** output.

> **Pivot vs Raw Data timestamps:** For aggregated queries (`agg=AVG`), ThingsBoard returns each row timestamped at the **midpoint** of its interval. The Raw Data sheet keeps this midpoint. The Pivot sheet snaps timestamps to the **interval start**, so pivot rows align to clean boundaries. For hourly data, Pivot timestamps can be up to 30 minutes earlier than the matching Raw Data row. Raw queries (`agg=NONE`) are unaffected — both sheets use the same timestamp.

---

## Advanced: reportConfig override

Leave the `reportConfig` field empty to use the settings above.
To override, paste a JSON object. Sections merge differently:

| Section | Behaviour |
|---|---|
| `formatting`, `agg_map`, `sheets` | **Shallow merge** — only the keys you provide override defaults; omitted keys keep their defaults |
| `column_map` | **Full replace** — the entire default is replaced; key order controls column order in Excel |
| `filename`, `filename_timestamp` | Simple replace |

```json
{
  "column_map": {
    "EntityName telemetryKey": ["Header row 1", "Header row 2"]
  },
  "agg_map": {
    "pmIn1HrAvg": "max",
    "default": "mean"
  },
  "sheets": {
    "week_start": "Monday",
    "partial_period": false
  },
  "formatting": {
    "number_format": "#,##0.00"
  }
}
```

`column_map` key format: `"<entity_name> <telemetry_key>"` — the ThingsBoard device/asset name (exactly as it appears on the dashboard), a single space, then the telemetry key name. If the entity name contains spaces, the key still uses the full name (e.g. `"Unit A temperature"`). Enable **Show Debug Panel** to get a `_Config` sheet in the Excel output listing all exact column names.

You can also override the query (bypasses auto-agg):

```json
{
  "query": {
    "agg": "AVG",
    "interval": 3600000,
    "limit": 50000,
    "order": "ASC"
  }
}
```

---

## API endpoint

The widget POSTs to:
```
{window.location.origin}/api/pivot-excel/v1
```

The backend expects a JSON payload — see `tb_pivot_excel/v1/main.py` → `generate_pivot_excel_file()` for the full spec.
