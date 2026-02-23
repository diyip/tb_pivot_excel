# tb_pivot_excel

Fetches timeseries telemetry from a ThingsBoard instance and exports it to a formatted multi-sheet Excel file (.xlsx).

Consists of two parts that work together:

- **Backend** (`v1/main.py`) — Python service called via a REST endpoint on the tb-automation server
- **Widget** (`v1/widget/`) — ThingsBoard custom widget that the user clicks to trigger the export

---

## How it works

```
User clicks "Download Excel" in ThingsBoard dashboard
        │
        ▼
TB Widget (widget.js)
  • Resolves selected date range → startTs_ms / endTs_ms
  • Collects entities and telemetry keys from the widget data source
  • POSTs JSON payload to /api/pivot-excel/v1
        │
        ▼
Backend (v1/main.py) — running on tb-automation server
  • Fetches timeseries from ThingsBoard REST API
  • Builds Raw Data and Pivot DataFrames
  • Resamples to Daily / Weekly / Monthly / Yearly
  • Writes formatted .xlsx (multi-sheet)
  • Returns file as download
        │
        ▼
Browser downloads the .xlsx file
```

---

## Output sheets

| Sheet | Description |
|---|---|
| **Pivot** | One row per timestamp, one column per (asset × key) |
| **Daily** | Pivot resampled to daily periods |
| **Weekly** | Pivot resampled to weekly periods |
| **Monthly** | Pivot resampled to monthly periods |
| **Yearly** | Pivot resampled to yearly periods |
| **Raw Data** | Raw telemetry rows as returned from ThingsBoard |

---

## Deploying to a new ThingsBoard instance

### Part 1 — Backend

The backend runs on the **tb-automation server** (not inside ThingsBoard). It must be reachable from ThingsBoard via HTTP.

#### Step 1 — Add the project to tb-automation

Clone or copy this repo into the `projects/` directory of the tb-automation installation:

```
tb-automation/
├── core/
├── projects/
│   └── tb_pivot_excel/   ← this repo goes here
├── outputs/
└── .venv/
```

#### Step 2 — Configure the tenant

Add the new ThingsBoard instance to the tb-automation tenant config. The `tenant_id` you use here is the identifier passed in the widget payload (see Part 2, Step 5).

Each tenant entry needs at minimum:
- ThingsBoard URL (e.g. `https://your-tb-instance.example.com`)
- ThingsBoard credentials for API access (username / password or token)
- `display_name` — used to name the output subfolder under `outputs/`

Refer to your tb-automation `config.py` / `tenants.json` for the exact format.

#### Step 3 — Register the API endpoint

Register the route `/api/pivot-excel/v1` in your tb-automation web server to call:

```python
from projects.tb_pivot_excel.v1.main import generate_pivot_excel_file

# In your route handler:
result_path = generate_pivot_excel_file(payload, tenant_id)
# Then return result_path as a file download response
```

The endpoint expects a **POST** request with a JSON body (see Payload reference below).

#### Step 4 — Test the backend locally

Use the provided `run.sh` to verify the backend works before wiring up the widget:

```bash
# From inside tb-automation root (so .venv and core/ are available)
cd projects/tb_pivot_excel/v1
./run.sh test_widget_payload.json <tenant_id>
```

A successful run prints `output: outputs/<tenant>/<filename>.xlsx`.

---

### Part 2 — ThingsBoard Widget

#### Step 1 — Open Widget Library

In ThingsBoard, go to **Widget Library** → open or create a **Widget Bundle**.

#### Step 2 — Create the widget

Click **Add new widget** and choose type **"Latest values"**.

Set the widget name to:
```
YIP - Timeseries table Excel report (Raw + Pivot)
```

#### Step 3 — Paste widget files

Paste the content of each file into the corresponding ThingsBoard tab:

| File | ThingsBoard tab |
|---|---|
| `v1/widget/widget.html` | HTML |
| `v1/widget/widget.js` | JavaScript |
| `v1/widget/schema.json` | Settings schema (JSON) |

#### Step 4 — Save the widget

Click **Save** in the widget editor.

#### Step 5 — Add widget to a dashboard

1. Open the target dashboard and enter edit mode.
2. Add widget → select your bundle → select `YIP - Timeseries table Excel report (Raw + Pivot)`.
3. In the **Data** tab, add the assets/devices and telemetry keys you want to export.
4. In the **Settings** tab, configure the widget (see Widget settings below).

Key setting to update for each ThingsBoard instance: set `tenant_id` in the **Advanced** settings or via `reportConfig` if exposed — or confirm the backend is routing correctly based on the origin URL.

#### Step 6 — Verify

Click the **Download Excel** button on the dashboard. The browser should download a `.xlsx` file.

---

## Widget settings

Configure these in the widget **Settings** panel when placing it on a dashboard.

| Setting | Default | Description |
|---|---|---|
| `defaultReportRange` | `last_60_days` | Initial date range shown in the dropdown |
| `customDays` | `14` | Days used when "Last XX days" is selected |
| `customMonths` | `6` | Months used when "Last XX months" is selected |
| `defaultPageSize` | `30` | Rows per page in the embedded timeseries table |
| `showTable` | `true` | Show / hide the embedded data preview table |
| `showDebug` | `false` | Show / hide the debug info panel |
| `filename` | `tb_pivot_export` | Base name for the downloaded .xlsx (without extension) |
| `filenameRange` | `true` | Append the selected range label to the filename |
| `filenameTimestamp` | `true` | Append a datetime stamp to the filename |
| `aggDefault` | `mean` | Default aggregation for Daily/Weekly/Monthly/Yearly sheets |
| `weekStart` | `Sunday` | First day of week for the Weekly sheet |
| `partialPeriod` | `false` | Include incomplete periods in aggregated sheets |
| `reportConfig` | *(empty)* | Advanced JSON override — see section below |

Available date range options: `last_24_hours`, `last_7_days`, `last_30_days`, `last_60_days`, `custom_days`, `last_month`, `last_3_months`, `custom_months`, `this_year`, `last_year`.

---

## Advanced: reportConfig override

Leave `reportConfig` empty to use the widget settings above. To override specific behaviour, paste a JSON object — only the keys you include are applied; everything else falls back to defaults.

### Column labels (column_map)

By default, column headers are auto-split from the column name (`"AssetName key"` → two-row header). Use `column_map` to set custom labels:

```json
{
  "column_map": {
    "7X_B-7X02-A pmIn1HrAvg": ["Unit B", "Indoor PM2.5 (1h avg)"],
    "8A_O-8A01-X pmOut1HrAvg": ["Unit 8A", "Outdoor PM2.5 (1h avg)"]
  }
}
```

Key format: `"<asset_name> <telemetry_key>"`. Value: list of header row labels top-to-bottom.

### Aggregation per key (agg_map)

```json
{
  "agg_map": {
    "pmIn1HrAvg": "max",
    "energyKwh":  "sum",
    "default":    "mean"
  }
}
```

Valid values: `mean`, `sum`, `min`, `max`, `first`, `last`.

### Sheet behaviour (sheets)

```json
{
  "sheets": {
    "week_start":     "Monday",
    "partial_period": false
  }
}
```

### Excel formatting (formatting)

```json
{
  "formatting": {
    "number_format":      "#,##0.00",
    "header_fill_colors": ["B8CCE4", "D9E1F2", "EEF2FA"],
    "sheet_pivot":        "Pivot",
    "sheet_daily":        "Daily"
  }
}
```

### Override ThingsBoard query

Bypasses the widget's auto-aggregation and sets the TB API query directly:

```json
{
  "query": {
    "agg":      "AVG",
    "interval": 3600000,
    "limit":    50000,
    "order":    "ASC"
  }
}
```

---

## Payload reference

The widget POSTs this JSON structure to `/api/pivot-excel/v1`:

```json
{
  "tenant_id":  "<tenant_id>",
  "timezone":   "Asia/Bangkok",
  "timeEpoch": {
    "startTs_ms": 1771293020855,
    "endTs_ms":   1771379420855
  },
  "entities": [
    { "type": "ASSET", "id": "<uuid>", "name": "AssetName" }
  ],
  "keys": ["telemetryKey1", "telemetryKey2"],
  "query": {
    "agg":   "NONE",
    "limit": 50000,
    "order": "ASC"
  },
  "reportConfig": {}
}
```

Backend limits (hard caps regardless of payload):

| Limit | Value |
|---|---|
| Max entities | 500 |
| Max keys | 100 |
| Max points per key per entity | 10,000 |

---

## Currently deployed on

| Instance | URL |
|---|---|
| LH Smart Home | smarthome.lh.co.th |
| YIP TB PE | tbpe.yipintsoi.net |

---

## Project structure

```
tb_pivot_excel/
├── v1/
│   ├── main.py                   # Core logic — fetch, pivot, export
│   ├── settings.py               # Default config and backend limits
│   ├── run.sh                    # Local test runner
│   ├── test_widget_payload.json  # Sample payload for local testing
│   └── widget/
│       ├── widget.html           # ThingsBoard widget HTML
│       ├── widget.js             # ThingsBoard widget JavaScript
│       ├── schema.json           # ThingsBoard widget settings schema
│       └── INSTRUCTIONS.md      # Widget installation notes
├── test_widget_payloads/         # Additional sample payloads
├── settings.py                   # Top-level settings (mirrors v1)
├── main.py                       # Top-level entry point
└── run.sh                        # Top-level test runner
```
