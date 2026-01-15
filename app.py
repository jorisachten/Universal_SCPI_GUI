from __future__ import annotations

import re
import threading
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
from flask import Flask, jsonify, render_template, request

from universal_pyvisa import upyvisa

EXCEL_PATH = "SCIPY_DEF.xlsx"

app = Flask(__name__)

_lock = threading.Lock()
_mgr: Optional[upyvisa] = None


# --- SCPI descriptor loading -------------------------------------------------

@dataclass
class ScpiCommand:
    name: str
    cmd: str
    mode: str                 # "GET" or "SET"
    parameters_raw: str = ""  # original cell text (optional)

@dataclass
class ParamDef:
    name: str
    kind: str              # "free" | "options"
    options: List[str]
    format_spec: str = ""  # e.g. "V.3f" for free inputs


def _apply_format_spec(value: str, fmt: str) -> str:
    if not fmt:
        return value
    m = re.fullmatch(r"V\.(\d+)f", fmt.strip(), flags=re.IGNORECASE)
    if not m:
        return value
    decimals = int(m.group(1))
    try:
        f = float(value)
    except Exception:
        return value
    return f"{f:.{decimals}f}"


def _first_placeholder_names(cmd_template: str) -> List[str]:
    return [m.group(1).strip() for m in re.finditer(r"\{([^}]+)\}", cmd_template or "")]


def parse_param_defs(parameters_raw: str, cmd_template: str) -> List[ParamDef]:
    s = "" if parameters_raw is None else str(parameters_raw).strip()
    if s == "" or s.lower() in {"nan", "none"}:
        ph = _first_placeholder_names(cmd_template)
        return [ParamDef(name=p, kind="free", options=[], format_spec="") for p in ph]

    parts = [p.strip() for p in s.split("|")]
    out: List[ParamDef] = []

    for part in parts:
        if not part:
            continue

        if ":" in part:
            left, right = part.split(":", 1)
            left = left.strip()
            right = right.strip()

            if ";" in right:
                opts = [o.strip() for o in right.split(";") if o.strip() != ""]
                out.append(ParamDef(name=left, kind="options", options=opts, format_spec=""))
            else:
                out.append(ParamDef(name=left, kind="free", options=[], format_spec=right))
        else:
            out.append(ParamDef(name=part, kind="free", options=[], format_spec=""))

    return out


def _find_col(df: pd.DataFrame, wanted: List[str]) -> Optional[str]:
    cols = {str(c).strip().casefold(): c for c in df.columns}
    for w in wanted:
        if w.casefold() in cols:
            return cols[w.casefold()]
    return None


def _first_placeholder_name(cmd_template: str) -> str:
    m = re.search(r"\{([^}]+)\}", cmd_template or "")
    return m.group(1).strip() if m else ""


def _parse_parameter(parameters_raw: str, cmd_template: str) -> Tuple[str, List[str], str, str]:
    '''
    Determine parameter UI behavior for SET:

      1) Empty -> "none" (no input), unless cmd has a {...} placeholder -> "free"

      2) No ':' -> "free" input (param_name = whole string)

      3) Has ':' -> either:
         - dropdown options if right side contains ';'  => "options"
         - otherwise treat as free input with optional format spec => "free"
           Example: "CURRENT:V.3f" => free input, param_name="CURRENT", fmt="V.3f"
    Returns: (param_type, options, param_name, format_spec)
    '''
    s = "" if parameters_raw is None else str(parameters_raw).strip()
    if s == "" or s.lower() in {"nan", "none"}:
        ph = _first_placeholder_name(cmd_template)
        if ph:
            return ("free", [], ph, "")
        return ("none", [], "", "")

    if ":" in s:
        left, right = s.split(":", 1)
        left = left.strip()
        right = right.strip()
        if ";" in right:
            opts = [o.strip() for o in right.split(";") if o.strip() != ""]
            return ("options", opts, left, "")
        # treat as format spec (free input)
        return ("free", [], left, right)

    return ("free", [], s, "")


def _apply_format_spec(value: str, fmt: str) -> str:
    '''
    Supported fmt examples from your Excel:
      - "V.2f"  -> float with 2 decimals
      - "V.3f"  -> float with 3 decimals
    If fmt is unknown or conversion fails, returns value unchanged.
    '''
    if not fmt:
        return value
    m = re.fullmatch(r"V\.(\d+)f", fmt.strip(), flags=re.IGNORECASE)
    if not m:
        return value
    decimals = int(m.group(1))
    try:
        f = float(value)
    except Exception:
        return value
    return f"{f:.{decimals}f}"


def load_scpi_definitions(xlsx_path: str) -> Dict[str, List[ScpiCommand]]:
    xls = pd.ExcelFile(xlsx_path)
    defs: Dict[str, List[ScpiCommand]] = {}
    for sheet in xls.sheet_names:
        df = pd.read_excel(xls, sheet_name=sheet)

        name_col = _find_col(df, ["Name"])
        cmd_col = _find_col(df, ["CMD"])
        mode_col = _find_col(df, ["GET/SET"])
        param_col = _find_col(df, ["Parameter", "Parameters"])

        if not name_col or not cmd_col or not mode_col:
            continue

        out: List[ScpiCommand] = []
        for _, row in df.iterrows():
            n = "" if pd.isna(row[name_col]) else str(row[name_col]).strip()
            c = "" if pd.isna(row[cmd_col]) else str(row[cmd_col]).strip()
            m = "" if pd.isna(row[mode_col]) else str(row[mode_col]).strip().upper()

            p = ""
            if param_col and not pd.isna(row[param_col]):
                p = str(row[param_col]).strip()

            if not n or not c or m not in {"GET", "SET"}:
                continue

            out.append(ScpiCommand(name=n, cmd=c, mode=m, parameters_raw=p))
        defs[sheet] = out
    return defs


SCPI_DEFS: Dict[str, List[ScpiCommand]] = load_scpi_definitions(EXCEL_PATH)
SCPI_MODELS = set(SCPI_DEFS.keys())


def _get_mgr() -> upyvisa:
    global _mgr
    if _mgr is None:
        _mgr = upyvisa()
    return _mgr


def _instrument_to_dict(inst) -> Dict[str, Any]:
    return {
        "visa_name": inst.visa_name,
        "dev_kind": str(inst.dev_kind),
        "vendor": inst.vendor,
        "model": inst.model,
        "serial": inst.serial,
        "alias": inst.alias or "",
        "has_scpi_def": (inst.model in SCPI_MODELS),
    }


def _format_set_command(cmd_template: str, value: str) -> str:
    '''
    Insert value into a SET command template.

    Supported patterns:
      - contains "{value}"            -> replace with value
      - contains "{}"                 -> format(value)
      - contains "{SOMETHING}"        -> replace any {...} placeholder(s) with value
      - otherwise                     -> append space + value
    '''
    t = (cmd_template or "").strip()
    v = str(value).strip()

    if "{value}" in t:
        return t.replace("{value}", v)

    if "{}" in t:
        try:
            return t.format(v)
        except Exception:
            pass

    if re.search(r"\{[^}]+\}", t):
        return re.sub(r"\{[^}]+\}", v, t).strip()

    return f"{t} {v}".strip()


# --- Routes ------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/scan", methods=["POST"])
def api_scan():
    with _lock:
        mgr = _get_mgr()
        mgr.find_instruments()
        instruments = [_instrument_to_dict(i) for i in mgr.instrument_collection]
    return jsonify({"ok": True, "instruments": instruments})


@app.route("/api/set_alias", methods=["POST"])
def api_set_alias():
    data = request.get_json(force=True)
    alias = (data.get("alias") or "").strip()
    vendor = (data.get("vendor") or "").strip()
    model = (data.get("model") or "").strip()
    serial = (data.get("serial") or "").strip()

    if not alias or not vendor or not model or not serial:
        return jsonify({"ok": False, "error": "Missing alias/vendor/model/serial"}), 400

    with _lock:
        mgr = _get_mgr()
        ret = mgr.set_alias(alias, vendor, model, serial)
        instruments = [_instrument_to_dict(i) for i in mgr.instrument_collection]

    return jsonify({"ok": ret == 1, "instruments": instruments})


@app.route("/api/commands_for_alias", methods=["GET"])
def api_commands_for_alias():
    alias = (request.args.get("alias") or "").strip()
    if not alias:
        return jsonify({"ok": False, "error": "Missing alias"}), 400

    with _lock:
        mgr = _get_mgr()
        inst = next((i for i in mgr.instrument_collection if (i.alias or "").casefold() == alias.casefold()), None)

    if inst is None:
        return jsonify({"ok": False, "error": "Alias not found"}), 404

    model = inst.model
    cmds = SCPI_DEFS.get(model, [])
    payload_cmds = []
    for c in cmds:
        param_defs = parse_param_defs(c.parameters_raw, c.cmd)
        payload_cmds.append({
            "name": c.name,
            "cmd": c.cmd,
            "mode": c.mode,
            "parameters_raw": c.parameters_raw,
            "param_defs": [
                {
                    "name": d.name,
                    "kind": d.kind,
                    "options": d.options,
                    "format_spec": d.format_spec,
                }
                for d in param_defs
            ],
        })

    return jsonify({"ok": True, "model": model, "commands": payload_cmds})


@app.route("/api/run", methods=["POST"])
def api_run():
    data = request.get_json(force=True)
    alias = (data.get("alias") or "").strip()
    cmd_name = (data.get("name") or "").strip()

    values = data.get("values")
    single_value = str(data.get("value") or "").strip()

    if not alias or not cmd_name:
        return jsonify({"ok": False, "error": "Missing alias/name"}), 400

    with _lock:
        mgr = _get_mgr()
        inst = next((i for i in mgr.instrument_collection if (i.alias or "").casefold() == alias.casefold()), None)

    if inst is None:
        return jsonify({"ok": False, "error": "Alias not found"}), 404

    model = inst.model
    cmds = SCPI_DEFS.get(model, [])
    c = next((x for x in cmds if x.name.casefold() == cmd_name.casefold()), None)
    if c is None:
        return jsonify({"ok": False, "error": f"Command '{cmd_name}' not found for model '{model}'"}), 404

    param_defs = parse_param_defs(c.parameters_raw, c.cmd)

    if values is None and single_value != "" and len(param_defs) == 1:
        values = {param_defs[0].name: single_value}

    if values is None:
        values = {}
    if not isinstance(values, dict):
        return jsonify({"ok": False, "error": "values must be an object/dict"}), 400

    try:
        if c.mode == "GET":
            cmd_to_send = c.cmd.strip()
            # If placeholders exist, require values and substitute
            if param_defs:
                for d in param_defs:
                    if d.name not in values or str(values.get(d.name, "")).strip() == "":
                        return jsonify({"ok": False, "error": f"Missing value for {d.name}"}), 400
                    v = str(values[d.name]).strip()
                    if getattr(d, "kind", "free") == "free":
                        v = _apply_format_spec(v, getattr(d, "format_spec", ""))
                    cmd_to_send = re.sub(r"\{" + re.escape(d.name) + r"\}", v, cmd_to_send)

                if re.search(r"\{[^}]+\}", cmd_to_send) and values:
                    first_v = str(next(iter(values.values()))).strip()
                    cmd_to_send = re.sub(r"\{[^}]+\}", first_v, cmd_to_send)

            resp = mgr.query(alias, cmd_to_send)
            return jsonify({"ok": True, "mode": "GET", "cmd": cmd_to_send, "response": resp})

        cmd_to_send = c.cmd.strip()

        if len(param_defs) == 0:
            mgr.write(alias, cmd_to_send)
            return jsonify({"ok": True, "mode": "SET", "cmd": cmd_to_send, "response": ""})

        for d in param_defs:
            if d.name not in values or str(values.get(d.name, "")).strip() == "":
                return jsonify({"ok": False, "error": f"Missing value for {d.name}"}), 400

            v = str(values[d.name]).strip()
            if d.kind == "free":
                v = _apply_format_spec(v, d.format_spec)

            cmd_to_send = re.sub(r"\{" + re.escape(d.name) + r"\}", v, cmd_to_send)

        if re.search(r"\{[^}]+\}", cmd_to_send):
            if values:
                first_v = str(next(iter(values.values()))).strip()
                cmd_to_send = re.sub(r"\{[^}]+\}", first_v, cmd_to_send)

        mgr.write(alias, cmd_to_send)
        return jsonify({"ok": True, "mode": "SET", "cmd": cmd_to_send, "response": ""})
    except Exception as e:
        return jsonify({"ok": False, "error": f"{type(e).__name__}: {e}"}), 500


@app.route("/api/custom", methods=["POST"])
def api_custom():
    data = request.get_json(force=True)
    alias = (data.get("alias") or "").strip()
    cmd = (data.get("cmd") or "").strip()

    if not alias or not cmd:
        return jsonify({"ok": False, "error": "Missing alias/cmd"}), 400

    with _lock:
        mgr = _get_mgr()

    try:
        # heuristic: if command contains '?' treat as query
        if "?" in cmd:
            resp = mgr.query(alias, cmd)
            return jsonify({"ok": True, "cmd": cmd, "response": resp})
        mgr.write(alias, cmd)
        return jsonify({"ok": True, "cmd": cmd, "response": ""})
    except Exception as e:
        return jsonify({"ok": False, "error": f"{type(e).__name__}: {e}"}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
