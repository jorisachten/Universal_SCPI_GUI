async function postJSON(url, data) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data || {})
  });
  const out = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(out.error || ("HTTP " + resp.status));
  return out;
}

async function getJSON(url) {
  const resp = await fetch(url, { method: "GET" });
  const out = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(out.error || ("HTTP " + resp.status));
  return out;
}

const statusEl = document.getElementById("status");
function setStatus(msg, isErr=false) {
  statusEl.textContent = msg || "";
  statusEl.classList.toggle("err", !!isErr);
}

const historyBox = document.getElementById("historyBox");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const copyHistoryBtn = document.getElementById("copyHistoryBtn");
const delayInput = document.getElementById("delayInput");
const addDelayBtn = document.getElementById("addDelayBtn");

function escapePy(s) {
  return String(s ?? "").replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function ensureImageImports() {
  if (!historyBox) return;
  const cur = historyBox.value || "";
  const lines = cur ? cur.split(/\r?\n/) : [];

  const hasBytesIO = /^\s*from\s+io\s+import\s+BytesIO\s*$/m.test(cur);
  const hasPIL = /^\s*from\s+PIL\s+import\s+Image\s*$/m.test(cur);

  // Insert imports after existing import lines (similar to ensureTimeImported)
  let insertAt = 0;
  while (insertAt < lines.length && /^\s*(from\s+\S+\s+import\s+\S+|import\s+\S+)/.test(lines[insertAt])) {
    insertAt++;
  }

  const toAdd = [];
  if (!hasBytesIO) toAdd.push("from io import BytesIO");
  if (!hasPIL) toAdd.push("from PIL import Image");

  if (toAdd.length) {
    lines.splice(insertAt, 0, ...toAdd);
    setHistory(lines.join("\n").replace(/^\n+/, ""));
  }
}

function ensureTimeImported() {
  if (!historyBox) return;
  const cur = historyBox.value || "";
  // If the user already has an explicit time import, don't add it.
  if (/^\s*import\s+time\s*$/m.test(cur) || /^\s*from\s+time\s+import\s+/m.test(cur)) return;
  // Insert import time near the top (after any existing import lines)
  const lines = cur ? cur.split(/\r?\n/) : [];
  let insertAt = 0;
  while (insertAt < lines.length && /^\s*(from\s+\S+\s+import\s+\S+|import\s+\S+)/.test(lines[insertAt])) {
    insertAt++;
  }
  lines.splice(insertAt, 0, "import time");
  setHistory(lines.join("\n").replace(/^\n+/, ""));
}

function setHistory(text) {
  if (!historyBox) return;
  historyBox.value = text;
  historyBox.scrollTop = historyBox.scrollHeight;
}

function appendHistory(line) {
  if (!historyBox) return;
  const cur = historyBox.value || "";
  const next = cur ? (cur + "\n" + line) : line;
  setHistory(next);
}

function clearHistory() {
  setHistory("");
}

async function copyHistoryToClipboard() {
  if (!historyBox) return;

  const text = historyBox.value || "";
  if (!text) return;

  // Try modern clipboard API first
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch (e) {
    // Fallback below
  }

  // Fallback: temporary textarea (works everywhere)
  const tmp = document.createElement("textarea");
  tmp.value = text;
  tmp.style.position = "fixed";
  tmp.style.left = "-9999px";
  tmp.style.top = "-9999px";
  document.body.appendChild(tmp);

  tmp.focus();
  tmp.select();
  document.execCommand("copy");

  document.body.removeChild(tmp);
}

function showImageModal(dataUrl) {
  const imgModal = document.getElementById("imgModal");
  const imgModalImg = document.getElementById("imgModalImg");
  if (!imgModal || !imgModalImg) return;
  imgModalImg.src = dataUrl;
  imgModal.classList.remove("modalHidden");
  imgModal.classList.add("modalShown");
}
function hideImageModal() {
  const imgModal = document.getElementById("imgModal");
  if (!imgModal) return;
  imgModal.classList.add("modalHidden");
  imgModal.classList.remove("modalShown");
}
document.addEventListener("DOMContentLoaded", () => {
  const imgModalClose = document.getElementById("imgModalClose");
  const imgModalBackdrop = document.getElementById("imgModalBackdrop");
  if (imgModalClose) imgModalClose.addEventListener("click", hideImageModal);
  if (imgModalBackdrop) imgModalBackdrop.addEventListener("click", hideImageModal);
});

const instTbody = document.querySelector("#instTable tbody");

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function makeDiagText(cmd, resp, okForSet=false) {
  const c = (cmd ?? "").trim();
  const r = (resp ?? "").trim();
  if (r) return `${c} --> ${r}`;
  // For SET with no response, show only the command (no fake OK)
  return okForSet ? `${c}` : `${c} -->`;
}

function renderCustomOnly(cell, alias) {
  const table = document.createElement("div");
  table.className = "cmdTable";

  const header = document.createElement("div");
  header.className = "cmdHeader";
  header.innerHTML = `
    <div class="cmdH">Input parameter</div>
    <div class="cmdH">Send command</div>
    <div class="cmdH">Diagnostics</div>
  `;
  table.appendChild(header);

  

  cell.innerHTML = "";
  cell.appendChild(table);
}

async function loadCommandsIntoCell(alias, model, cell) {
  cell.innerHTML = `<div class="small">Loading…</div>`;
  try {
    const data = await getJSON(`/api/commands_for_alias?alias=${encodeURIComponent(alias)}`);
    const cmds = data.commands || [];
    if (!cmds.length) {
      cell.innerHTML = `<div class="small">No commands defined for model <strong>${escapeHtml(model)}</strong>.</div>`;
      return;
    }

    const table = document.createElement("div");
    table.className = "cmdTable";

    const header = document.createElement("div");
    header.className = "cmdHeader";
    header.innerHTML = `
      <div class="cmdH">Input parameter</div>
      <div class="cmdH">Send command</div>
      <div class="cmdH">Diagnostics</div>
    `;
    table.appendChild(header);

    // Custom command row
    {
      const row = document.createElement("div");
      row.className = "cmdRow3";

      

    }

    cmds.forEach(c => {
      const name = c.name;
      const mode = c.mode;

      const row = document.createElement("div");
      row.className = "cmdRow3";

      // Col1 input(s)
      let paramDefs = c.param_defs || [];
      if (c.is_image) paramDefs = [];
      const inputs = []; // {name, el}

      let inputCell = document.createElement("div");
      inputCell.className = "cmdEmpty";

      if (paramDefs.length > 0) {
        const wrap = document.createElement("div");
        wrap.className = "paramWrap";

        paramDefs.forEach(d => {
          const kind = d.kind || "free";
          const pname = d.name || "value";

          if (kind === "options") {
            const sel = document.createElement("select");
            sel.className = "cmdInput paramMini";
            (d.options || []).forEach(o => {
              const opt = document.createElement("option");
              opt.value = o;
              opt.textContent = o;
              sel.appendChild(opt);
            });
            inputs.push({ name: pname, el: sel });
            wrap.appendChild(sel);
          } else {
            const inp = document.createElement("input");
            inp.className = "cmdInput paramMini";
            inp.placeholder = pname + "…";
            inputs.push({ name: pname, el: inp });
            wrap.appendChild(inp);
          }
        });

        inputCell = wrap;
      }

      // Col2 button
      const btn = document.createElement("button");
      btn.className = "cmdBtn";
      btn.textContent = name;

      // Col3 diagnostics
      const out = document.createElement("div");
      out.className = "cmdOut";

      btn.addEventListener("click", async () => {
        out.textContent = "";
        try {

          if (c.is_image) {
            const r = await postJSON("/api/screenshot", { alias, cmd: c.cmd });
            appendHistory(`setup.query_binary('${escapePy(alias)}','${escapePy(r.cmd)}')  # screenshot (binary)`);
            const url = `data:${r.mime};base64,${r.b64}`;
            showImageModal(url);
            const diag = `${r.cmd} --> [image]`;
            out.textContent = diag;
            out.title = diag;
            return;
          }

          if (mode === "GET") {
            let payload = { alias, name };
            if (inputs.length > 0) {
              const values = {};
              inputs.forEach(x => values[x.name] = (x.el.value ?? "").trim());
              payload.values = values;
            }
            const r = await postJSON("/api/run", payload);
            appendHistory(`setup.query('${escapePy(alias)}','${escapePy(r.cmd)}')`);
            const diag = makeDiagText(r.cmd, r.response, false);
            out.textContent = diag;
            out.title = diag;
          } else {
            let payload = { alias, name };
            if (inputs.length > 0) {
              const values = {};
              inputs.forEach(x => values[x.name] = (x.el.value ?? "").trim());
              payload.values = values;
            }
            const r = await postJSON("/api/run", payload);
            appendHistory(`setup.write('${escapePy(alias)}','${escapePy(r.cmd)}')`);
            const diag = makeDiagText(r.cmd, r.response, true);
            out.textContent = diag;
            out.title = diag;
          }
        } catch (e) {
          out.textContent = "Error: " + e.message;
          out.title = out.textContent;
        }
      });

      row.appendChild(inputCell);
      row.appendChild(btn);
      row.appendChild(out);
      table.appendChild(row);
    });

    cell.innerHTML = "";
    cell.appendChild(table);
  } catch (e) {
    cell.innerHTML = `<div class="errBox">${escapeHtml(e.message)}</div>`;
  }
}

function renderInstruments(instruments) {
  instTbody.innerHTML = "";

  instruments.forEach(inst => {
    const tr = document.createElement("tr");

    const tdDev = document.createElement("td");
    tdDev.className = "devCell";
    const hasDef = !!inst.has_scpi_def;
    tdDev.innerHTML = `
      <div class="devMain">
        <div class="devTop">${escapeHtml(inst.vendor)} <strong>${escapeHtml(inst.model)}</strong></div>
        <div class="devSub">Identifier: ${escapeHtml(inst.serial)}</div>
        <div class="devSub">VISA address: ${escapeHtml(inst.visa_name)}</div>
      </div>
      <div class="tagWrap">
        ${hasDef ? `<span class="okTag">Excel Descriptor present</span>` : `<span class="noTag">No Excel Descriptor</span>`}
      </div>
    `;

    const tdAlias = document.createElement("td");
    tdAlias.className = "aliasCellCol";

    const aliasInput = document.createElement("input");
    aliasInput.className = "aliasInput";
    aliasInput.value = inst.alias ?? "";
    aliasInput.placeholder = "alias…";

    const setBtn = document.createElement("button");
    setBtn.className = "secondary";
    setBtn.textContent = "Set alias";

    setBtn.addEventListener("click", async () => {
      try {
        setStatus("Setting alias…");
        const out = await postJSON("/api/set_alias", {
          alias: aliasInput.value,
          vendor: inst.vendor,
          model: inst.model,
          serial: inst.serial
        });
        setStatus("Alias updated.");
        appendHistory(`setup.set_alias('${escapePy(aliasInput.value)}','${escapePy(inst.vendor)}','${escapePy(inst.model)}','${escapePy(''+inst.serial)}')`);
        renderInstruments(out.instruments || []);
      } catch (e) {
        setStatus(e.message, true);
      }
    });

    tdAlias.appendChild(aliasInput);
    tdAlias.appendChild(setBtn);

    const tdCmd = document.createElement("td");
    tdCmd.className = "cmdCell";

    const alias = (inst.alias || "").trim();
    if (!alias) {
      tdCmd.innerHTML = `<div class="small">Set an alias to show commands.</div>`;
    } else if (!hasDef) {
      renderCustomOnly(tdCmd, alias);
    } else {
      loadCommandsIntoCell(alias, inst.model, tdCmd);
    }

    tr.appendChild(tdDev);
    tr.appendChild(tdAlias);
    tr.appendChild(tdCmd);

    instTbody.appendChild(tr);
  });
}

document.getElementById("scanBtn").addEventListener("click", async () => {
  try {
    setStatus("Discovering…");
    const out = await postJSON("/api/scan", {});
    renderInstruments(out.instruments || []);
    clearHistory();
    appendHistory("from universal_pyvisa import upyvisa");
    appendHistory("setup = upyvisa()");
    setStatus("Done.");
  } catch (e) {
    setStatus(e.message, true);
  }
});

instTbody.innerHTML = `<tr><td colspan="3" class="small">Click “Discover” to scan instruments.</td></tr>`;
if (clearHistoryBtn) {
  clearHistoryBtn.addEventListener("click", () => clearHistory());
}
if (copyHistoryBtn) {
  copyHistoryBtn.addEventListener("click", async () => {
    try {
      await copyHistoryToClipboard();
      setStatus("History copied.");
    } catch (e) {
      setStatus("Copy failed: " + e.message, true);
    }
  });
}
if (addDelayBtn) {
  addDelayBtn.addEventListener("click", () => {
    try {
      const raw = (delayInput ? delayInput.value : "").trim();
      if (!raw) {
        setStatus("Enter a delay in seconds.", true);
        return;
      }
      const sec = Number(raw.replace(",", "."));
      if (!Number.isFinite(sec) || sec < 0) {
        setStatus("Delay must be a non-negative number.", true);
        return;
      }
      ensureTimeImported();
      appendHistory(`time.sleep(${sec})`);
      setStatus("Delay added.");
    } catch (e) {
      setStatus("Failed to add delay: " + e.message, true);
    }
  });
}