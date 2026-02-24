# =============================================================================
# tb_pivot_excel/v1/settings.py
#
# Description:
#   Default configuration and backend safety limits for tb_pivot_excel.
#
#   DEFAULT_REPORT_CONFIG mirrors the user-facing reportConfig payload exactly.
#   Any key here can be overridden by the user via payload.reportConfig.
#   Backend limits are hard caps applied regardless of user input.
#
# Version: 2026.02.00 - Wit Wonghanchao
#   - Replaced scattered uppercase constants with DEFAULT_REPORT_CONFIG
#   - Structure mirrors reportConfig payload for clarity
#   - Added resolve_config() to own merge-with-defaults logic
# =============================================================================

import copy

# ── Default reportConfig (mirrors user payload reportConfig exactly) ───────────
DEFAULT_REPORT_CONFIG = {

    # Output file
    "filename":           "tb_pivot_export.xlsx",
    "filename_timestamp": True,

    # Column order and header labels per column.
    # Key   = "<asset_name> <telemetry_key>"  e.g. "7X_B-7X02-A pmIn1HrAvg"
    # Value = list of header row labels top-to-bottom e.g. ["Unit A", "Indoor PM2.5"]
    # Empty = auto-split column name into 2-row header (asset row / key row)
    "column_map": {},

    # Aggregation function per telemetry key for Daily/Weekly/Monthly/Yearly sheets.
    # "default" applies to any key not explicitly listed.
    # Valid values: "mean", "sum", "min", "max", "first", "last"
    "agg_map": {
        "default": "mean",
    },

    # Aggregated sheet behavior
    # week_start:     "Sunday" or "Monday"
    # partial_period: False = only include fully complete periods
    "sheets": {
        "week_start":     "Sunday",
        "partial_period": False,
    },

    # Excel visual formatting
    "formatting": {
        # Sheet names
        "sheet_raw":          "Raw Data",
        "sheet_pivot":        "Pivot",
        "sheet_daily":        "Daily",
        "sheet_weekly":       "Weekly",
        "sheet_monthly":      "Monthly",
        "sheet_yearly":       "Yearly",

        # Header styling
        "header_fill_colors": ["B8CCE4", "D9E1F2", "EEF2FA"],
        "header_font_bold":   True,
        "header_font_size":   11,
        "header_alignment":   "center",

        # Cell styling
        "border_style":       "thin",
        "number_format":      "#,##0.00",
        "datetime_format":    "yyyy-mm-dd hh:mm:ss",
        "date_format":        "yyyy-mm-dd",

        # Column width (characters)
        "max_col_width":      60,
        "min_col_width":      18,

        # Freeze panes [rows_to_freeze, cols_to_freeze]
        "freeze_raw":         [1, 0],
        "freeze_pivot":       [1, 1],
        "freeze_daily":       [1, 1],
        "freeze_weekly":      [1, 1],
        "freeze_monthly":     [1, 1],
        "freeze_yearly":      [1, 1],
    },
}

# ── Backend safety limits (not user-facing) ────────────────────────────────────
DEFAULT_TIMEZONE              = "Asia/Bangkok"
MAX_ENTITIES                  = 500
MAX_KEYS                      = 100
MAX_POINTS_PER_KEY_PER_ENTITY = 10000

# ── Debug flags (developer use only) ──────────────────────────────────────────
DEBUG_CONFIG_SHEET            = False


# ── Config resolver ────────────────────────────────────────────────────────────

def resolve_config(defaults: dict, overrides: dict) -> dict:
    """
    Merge overrides on top of defaults section by section.

    Rules per section:
    - None/omitted  -> use defaults
    - {}            -> use empty (disables defaults for that section)
    - {...}         -> merge on top of defaults (except column_map: replace entirely)
    """
    base = copy.deepcopy(defaults)

    if not overrides or not isinstance(overrides, dict):
        return base

    rc = overrides

    # filename / filename_timestamp — simple overrides
    if "filename" in rc:
        base["filename"] = rc["filename"]
    if "filename_timestamp" in rc:
        base["filename_timestamp"] = rc["filename_timestamp"]

    # formatting — merge over defaults
    pf = rc.get("formatting")
    if pf is not None:
        base["formatting"] = {**base["formatting"], **pf} if pf else {}

    # column_map — replace entirely (order matters, no sensible base to merge with)
    if "column_map" in rc:
        base["column_map"] = rc["column_map"] if rc["column_map"] is not None else {}

    # agg_map — merge over defaults
    pa = rc.get("agg_map")
    if pa is not None:
        base["agg_map"] = {**base["agg_map"], **pa} if pa else {}

    # sheets — merge over defaults
    ps = rc.get("sheets")
    if ps is not None:
        base["sheets"] = {**base["sheets"], **ps} if ps else {}

    return base
