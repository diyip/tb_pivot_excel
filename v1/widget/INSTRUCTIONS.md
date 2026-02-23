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
| `showDebug` | boolean | `false` | Show/hide the debug info panel |
| `filename` | string | `tb_pivot_export` | Base name for the downloaded .xlsx file |
| `filenameRange` | boolean | `true` | Append the selected range label to the filename |
| `filenameTimestamp` | boolean | `true` | Append a datetime stamp to the filename |
| `aggDefault` | select | `mean` | Default aggregation for Daily/Weekly/Monthly/Yearly sheets |
| `weekStart` | select | `Sunday` | First day of week for the Weekly sheet |
| `partialPeriod` | boolean | `false` | Include incomplete periods in aggregated sheets |
| `reportConfig` | textarea | *(empty)* | Advanced JSON override — see section below |

---

## Advanced: reportConfig override

Leave the `reportConfig` field empty to use the settings above.
To override, paste a JSON object. Any key you include replaces the corresponding default.

```json
{
  "column_map": {
    "EntityName keyName": ["Header row 1", "Header row 2"]
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
