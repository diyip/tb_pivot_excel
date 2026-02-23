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
Flask (core/app.py)  ←  running in Docker on tb-automation server
  • Blueprint: core/routes/pivot_excel_v1.py handles POST /api/pivot-excel/v1
  • Calls projects/tb_pivot_excel/v1/main.py → generate_pivot_excel_file()
        │
        ▼
Backend (v1/main.py)
  • Fetches timeseries from ThingsBoard REST API
  • Builds Raw Data and Pivot DataFrames
  • Resamples to Daily / Weekly / Monthly / Yearly
  • Writes formatted .xlsx (multi-sheet)
  • Returns file path → Flask sends file as download
        │
        ▼
Browser downloads the .xlsx file
```

---

## Flask routing architecture

Understanding this is essential before deploying or adding a new version.

### How the route is wired up

Each API version has **two files** in the tb-automation repo:

| File | Role |
|---|---|
| `core/routes/pivot_excel_v1.py` | Flask Blueprint — defines the URL route |
| `projects/tb_pivot_excel/v1/main.py` | Business logic — fetch, pivot, export |

**`core/routes/pivot_excel_v1.py`** registers the route and imports the logic:

```python
from flask import Blueprint, request, send_file

bp = Blueprint("pivot_excel_v1", __name__)

@bp.route("/api/pivot-excel/v1", methods=["POST", "OPTIONS"])
def pivot_excel_v1():
    if request.method == "OPTIONS":
        return "", 204
    payload   = request.get_json(silent=True) or {}
    tenant_id = payload.get("tenant_id", "lh_production_environment")
    from projects.tb_pivot_excel.v1.main import generate_pivot_excel_file
    out_path = generate_pivot_excel_file(payload, tenant_id)
    return send_file(out_path, as_attachment=True, ...)
```

**`core/app.py`** registers the blueprint at startup:

```python
from routes.pivot_excel_v1 import bp as pivot_excel_v1
app.register_blueprint(pivot_excel_v1)
```

### What lives where (and why it matters)

```
tb-automation/
├── core/                  ← baked into Docker image (requires rebuild to change)
│   ├── app.py             ← Flask app + blueprint registration
│   ├── routes/
│   │   └── pivot_excel_v1.py   ← URL route definition
│   └── Dockerfile
│
├── config/                ← mounted as volume (edit without rebuild)
│   ├── secrets.json       ← ThingsBoard credentials per tenant
│   └── settings.json      ← Non-sensitive settings per tenant
│
├── projects/              ← mounted as volume (edit without rebuild)
│   └── tb_pivot_excel/    ← this repo
│       └── v1/main.py     ← business logic
│
└── outputs/               ← mounted as volume — generated .xlsx files land here
```

**Key rule:** `projects/` and `config/` are Docker volumes — you can update them without rebuilding the image. But `core/routes/` and `core/app.py` are baked in — any change there requires `docker-compose up --build`.

---

### HAProxy — how traffic reaches Flask

HAProxy sits in front of everything and decides whether a request goes to ThingsBoard or to Flask, based on the URL path.

```
Internet
    │
    ▼
HAProxy :443
    ├── /api/pivot-excel*  →  Flask  (api-backend → 127.0.0.1:5000)
    ├── /api/reports*      →  Flask
    ├── /api/projects*     →  Flask
    ├── /api/health        →  Flask
    └── everything else    →  ThingsBoard (tb-backend → 127.0.0.1:8080)
```

The relevant ACL rule in `/etc/haproxy/haproxy.cfg`:

```
acl is_flask_pivot path_beg /api/pivot-excel
use_backend api-backend if ... is_flask_pivot
```

`path_beg` matches any path that **starts with** `/api/pivot-excel` — so `/api/pivot-excel/v1`, `/api/pivot-excel/v2`, and any future version are all routed to Flask automatically.

**No HAProxy changes are needed when adding a new version.** The only files that change are inside `core/` (Flask blueprint + app.py) and `projects/` (new logic).

### Tenant configuration

Tenants are configured in two files under `config/`:

- **`secrets.json`** — ThingsBoard URL and login credentials (keep this file secret)
- **`settings.json`** — Non-sensitive settings like `display_name`, enabled projects, rate limits

The `tenant_id` in the widget payload is the key used to look up both files. Example `settings.json` structure:

```json
{
  "tenants": {
    "your_tenant_id": {
      "name": "My ThingsBoard Instance",
      "enabled": true,
      "thingsboard": {
        "url": "https://your-tb.example.com"
      }
    }
  }
}
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

#### Step 1 — Add the project to tb-automation

Clone this repo into the `projects/` directory on the tb-automation server:

```bash
cd /path/to/tb-automation/projects
git clone https://github.com/diyip/tb_pivot_excel.git
```

No Docker rebuild needed — `projects/` is a mounted volume.

#### Step 2 — Configure the tenant

See the [Config file format](#config-file-format) section below for the full `secrets.json` and `settings.json` reference. Add an entry for the new tenant in both files, then restart the container — no Docker rebuild needed.

#### Step 3 — Register the route in Flask (if not already present)

Check `core/app.py` to confirm the v1 blueprint is registered:

```python
from routes.pivot_excel_v1 import bp as pivot_excel_v1
app.register_blueprint(pivot_excel_v1)
```

And confirm `core/routes/pivot_excel_v1.py` exists. If either is missing, add it and rebuild:

```bash
docker-compose up --build -d
```

If the blueprint is already registered (it is, on existing deployments), just restart the container to pick up the new tenant config:

```bash
docker-compose restart tb-automation
```

#### Step 4 — Test the backend locally

Use `run.sh` to verify the backend works before wiring up the widget:

```bash
# From tb-automation root
cd projects/tb_pivot_excel/v1
./run.sh test_widget_payload.json <your_tenant_id>
```

Edit `test_widget_payload.json` to use a real entity ID and `tenant_id` from your new instance. A successful run prints `output: outputs/<tenant>/<filename>.xlsx`.

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

#### Step 6 — Verify

Click the **Download Excel** button on the dashboard. The browser should download a `.xlsx` file.

---

## Adding a v2 in the future

When you need to release a new version with breaking changes (new payload format, new sheet structure, etc.) while keeping v1 live for existing dashboards.

### Step 1 — Create the new project code

```
projects/tb_pivot_excel/
└── v2/
    ├── __init__.py
    ├── main.py        ← new logic, must expose generate_pivot_excel_file(payload, tenant_id)
    ├── settings.py    ← new defaults
    ├── run.sh         ← local test runner
    └── widget/
        ├── widget.html
        ├── widget.js  ← must POST to /api/pivot-excel/v2
        └── schema.json
```

`projects/` is a volume — no Docker rebuild needed for this step.

### Step 2 — Create the new route file

Create **`core/routes/pivot_excel_v2.py`** in the tb-automation repo:

```python
from flask import Blueprint, request, send_file

bp = Blueprint("pivot_excel_v2", __name__)

@bp.route("/api/pivot-excel/v2", methods=["POST", "OPTIONS"])
def pivot_excel_v2():
    if request.method == "OPTIONS":
        return "", 204
    payload   = request.get_json(silent=True) or {}
    tenant_id = payload.get("tenant_id", "lh_production_environment")
    from projects.tb_pivot_excel.v2.main import generate_pivot_excel_file
    out_path = generate_pivot_excel_file(payload, tenant_id)
    return send_file(
        out_path,
        as_attachment=True,
        download_name=out_path.split("/")[-1],
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
```

### Step 3 — Register the blueprint in app.py

In **`core/app.py`**, add the two lines alongside the existing v1 registration:

```python
from routes.pivot_excel_v1 import bp as pivot_excel_v1
from routes.pivot_excel_v2 import bp as pivot_excel_v2   # ← add this

app.register_blueprint(pivot_excel_v1)
app.register_blueprint(pivot_excel_v2)                    # ← add this
```

### Step 4 — Rebuild the Docker image

`core/routes/` and `core/app.py` are baked into the image, so a rebuild is required:

```bash
docker-compose up --build -d
```

Verify both routes are live:

```bash
curl -X POST http://localhost:5000/api/pivot-excel/v1 -H "Content-Type: application/json" -d '{}'
curl -X POST http://localhost:5000/api/pivot-excel/v2 -H "Content-Type: application/json" -d '{}'
```

### Step 5 — Install v2 widget in ThingsBoard

Follow the same widget installation steps as Part 2 above, using the files from `v2/widget/`. Keep the v1 widget in place — existing dashboards continue to use `/api/pivot-excel/v1` unchanged.

### Summary of what changes for each version

| What | Needs Docker rebuild? |
|---|---|
| `projects/tb_pivot_excel/v2/` — new logic | No — it's a volume |
| `core/routes/pivot_excel_v2.py` — new route file | **Yes** |
| `core/app.py` — blueprint registration | **Yes** |
| `config/secrets.json` or `settings.json` — tenant config | No — it's a volume, just restart |
| Widget in ThingsBoard | No — done in TB UI |
| HAProxy config | **No** — `path_beg /api/pivot-excel` already covers all versions |

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

## Config file format

Both files live in `tb-automation/config/` and are mounted into the Docker container as read-only volumes. **Never commit these files to git.**

---

### Why two files?

The split follows a simple security principle:

| File | Contains | Who can see it |
|---|---|---|
| `secrets.json` | ThingsBoard credentials, passwords, API keys | Server admin only |
| `settings.json` | URLs, feature flags, display names | Can be shared with the team |

This way you can share `settings.json` for review or version control without exposing credentials.

---

### How they merge

When a request comes in with a `tenant_id`, `Config.get_tenant_config()` builds the final tenant config by:

1. Starting with the full entry from **`secrets.json`** for that `tenant_id`
2. Overlaying the entry from **`settings.json`** on top, key by key
3. For the nested `thingsboard` block specifically — it does a **shallow merge**, so you can override just `url` in `settings.json` without losing the credentials from `secrets.json`

```
secrets.json entry          settings.json entry         merged result
──────────────────────      ──────────────────────      ──────────────────────
{                           {                           {
  "display_name": "Prod",     "name": "Production",       "display_name": "Prod",
  "thingsboard": {            "enabled": true,             "name": "Production",
    "url":  "https://...",    "thingsboard": {             "enabled": true,
    "username": "u@x.com",      "url": "https://..."       "thingsboard": {
    "password": "••••"        }                              "url":  "https://...",
  }                         }                              "username": "u@x.com",
}                                                          "password": "••••"
                                                         }
                                                       }
```

**Practical rule:** put credentials in `secrets.json`, put everything else in `settings.json`. You only need a `secrets.json` entry for a tenant to use the API — a `settings.json`-only entry is valid but has no credentials to log in with.

---

### secrets.json

Holds ThingsBoard credentials and any other sensitive values. This is the primary source for tenant lookup.

```json
{
  "tenants": {
    "friendly_tenant_id": {
      "display_name": "My ThingsBoard Instance",
      "api_key": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "thingsboard": {
        "url":      "https://your-tb.example.com",
        "username": "admin@example.com",
        "password": "••••••••••••"
      }
    },
    "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx": {
      "display_name": "My ThingsBoard Instance",
      "thingsboard": {
        "url":      "https://your-tb.example.com",
        "username": "admin@example.com",
        "password": "••••••••••••"
      }
    }
  },
  "external_services": {
    "smtp": {
      "host":     "smtp.example.com",
      "port":     587,
      "username": "sender@example.com",
      "password": "••••••••••••"
    }
  }
}
```

#### Field reference

| Field | Required | Description |
|---|---|---|
| `tenants` | yes | Map of `tenant_id` → tenant config |
| `tenant_id` | yes | Either a UUID (ThingsBoard tenant UUID) or a friendly string name — must match what the widget sends in `payload.tenant_id` |
| `display_name` | yes | Human-readable name — used to name the output subfolder under `outputs/` |
| `api_key` | no | API key for tb-automation's own `require_auth` middleware (used by `/api/projects/*` routes) |
| `thingsboard.url` | see note | ThingsBoard instance URL. Required unless a global fallback is set in `settings.json` |
| `thingsboard.username` | yes | ThingsBoard login — typically the admin email address |
| `thingsboard.password` | yes | ThingsBoard login password |
| `external_services.smtp` | no | SMTP config for email features (not used by tb_pivot_excel) |

#### Two styles of tenant_id

You can register a tenant under a **UUID** (the ThingsBoard tenant UUID), a **friendly string name**, or both pointing to the same instance:

```json
{
  "tenants": {
    "my_production": {
      "display_name": "My Production TB",
      "thingsboard": {
        "username": "admin@example.com",
        "password": "••••••••••••"
      }
    },
    "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx": {
      "display_name": "My Production TB",
      "thingsboard": {
        "url":      "https://your-tb.example.com",
        "username": "admin@example.com",
        "password": "••••••••••••"
      }
    }
  }
}
```

#### ThingsBoard URL resolution

The backend resolves the TB URL with this priority:

1. `secrets.json` → `tenants.<tenant_id>.thingsboard.url`
2. Fallback: `settings.json` → `global.thingsboard.url`

If a friendly-name key has no `url`, it uses the global fallback. UUID keys should always include `url` explicitly.

#### JWT token caching

The backend logs in to ThingsBoard once and caches the JWT token at `.cache/tb_token_<tenant_id>.json`. It refreshes automatically when the token expires. If you ever get auth errors, delete the cache file and retry.

---

### settings.json

Holds non-sensitive settings. Merged on top of `secrets.json` — only the fields listed here override the corresponding secret entry.

```json
{
  "tenants": {
    "friendly_tenant_id": {
      "name":    "My ThingsBoard Instance",
      "enabled": true,
      "thingsboard": {
        "url": "https://your-tb.example.com"
      }
    }
  },
  "global": {
    "default_timezone": "Asia/Bangkok",
    "max_file_size_mb": 50,
    "thingsboard": {
      "url": "https://fallback-tb.example.com"
    }
  }
}
```

| Field | Description |
|---|---|
| `tenants.<id>.name` | Display name (non-sensitive copy of `display_name`) |
| `tenants.<id>.enabled` | Set to `false` to disable a tenant without removing its credentials |
| `tenants.<id>.thingsboard.url` | Can set URL here instead of in secrets if preferred |
| `global.default_timezone` | Fallback timezone when not specified in payload |
| `global.thingsboard.url` | Fallback TB URL for tenants that omit it in `secrets.json` |

---

## Currently deployed on

| Instance | URL | `tenant_id` in widget payload |
|---|---|---|
| LH Production Environment | https://smarthome.lh.co.th | `lh_production_environment` |
| LH Production Environment | https://smarthome.lh.co.th | `73b0d500-d265-11ea-ab22-49d6e5135835` |
| YIP Production Environment | https://tbpe.yipintsoi.net | `0a85b420-8d87-11ee-a473-27ffec2887b9` |

> LH has two `tenant_id` entries pointing to the same instance — a friendly name (`lh_production_environment`) and the ThingsBoard UUID. Both work. The friendly name uses the global fallback URL from `settings.json`; the UUID has the URL set explicitly in `secrets.json`.

---

## Project structure

```
tb_pivot_excel/                       ← this repo (lives in tb-automation/projects/)
├── v1/
│   ├── main.py                       # Core logic — fetch, pivot, export
│   ├── settings.py                   # Default config and backend limits
│   ├── run.sh                        # Local test runner
│   ├── test_widget_payload.json      # Sample payload for local testing
│   └── widget/
│       ├── widget.html               # ThingsBoard widget HTML
│       ├── widget.js                 # ThingsBoard widget JavaScript  (POSTs to /api/pivot-excel/v1)
│       ├── schema.json               # ThingsBoard widget settings schema
│       └── INSTRUCTIONS.md          # Widget installation notes
├── test_widget_payloads/             # Additional sample payloads
├── settings.py                       # Top-level settings (mirrors v1)
├── main.py                           # Top-level entry point
└── run.sh                            # Top-level test runner

tb-automation/core/                   ← separate repo — Flask app (baked into Docker image)
├── app.py                            # Flask app — registers blueprints
├── routes/
│   └── pivot_excel_v1.py             # Blueprint for POST /api/pivot-excel/v1
├── config.py                         # Tenant config loader
├── Dockerfile
└── requirements.txt
```
