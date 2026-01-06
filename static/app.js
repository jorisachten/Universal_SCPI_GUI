function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return e;
}

function escapeHtml(s) {
  return (s ?? "").toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function postJson(url, data) {
  const r = await fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(data),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
  return j;
}

function buildCommandsCell(dev) {
  if (!dev.found_in_excel) {
    return el("div", {}, ["—"]);
  }

  const wrap = el("div", {}, []);

  for (const cmd of dev.commands) {
    const isGet = cmd.get_set === "GET";

    const left = isGet ? el("div") : (() => {
      // SET: dropdown if options exist, else input box
      if (Array.isArray(cmd.options) && cmd.options.length > 0) {
        const sel = el("select", { id: `in_${dev.resource}_${cmd.name}`.replaceAll("::", "_") }, []);
        for (const opt of cmd.options) {
          sel.appendChild(el("option", { value: opt }, [opt]));
        }
        return sel;
      } else {
        return el("input", {
          type: "text",
          placeholder: cmd.param_name ? cmd.param_name : "value",
          id: `in_${dev.resource}_${cmd.name}`.replaceAll("::", "_"),
        });
      }
    })();

    const btn = el("button", {
      onclick: async () => {
        const outId = `out_${dev.resource}_${cmd.name}`.replaceAll("::", "_");
        const out = document.getElementById(outId);
        out.textContent = "…";

        let value = null;
        if (!isGet) {
          const inId = `in_${dev.resource}_${cmd.name}`.replaceAll("::", "_");
          const inp = document.getElementById(inId);
          value = inp ? inp.value : null;
        }

        try {
             const resp = await postJson("/api/send", {
              resource: dev.resource,
              get_set: cmd.get_set,
              cmd_template: cmd.cmd_template,
              param_name: cmd.param_name,
              fmt: cmd.fmt,
              value: value,
            });
            
            out.textContent =
              (resp.sent ? resp.sent + "  =>  " : "") +
              (resp.response ?? "");
            
            await refreshHistory();

        } catch (e) {
          out.textContent = "ERR: " + e.message;
        }
      }
    }, [cmd.name]);

    const sentPreview = el("div", { class: "small mono" }, [cmd.cmd_template]);

    const out = el("div", {
      class: "mono",
      id: `out_${dev.resource}_${cmd.name}`.replaceAll("::", "_")
    }, [""]);

    const row = el("div", { class: "cmd-row cmd-grid" }, [
      left,
      btn,
      sentPreview,
      out
    ]);

    wrap.appendChild(row);
  }

  return wrap;
}

function renderDevices(devices) {
  const table = el("table", {}, []);
  const thead = el("thead", {}, [
    el("tr", {}, [
      el("th", {}, ["Resource"]),
      el("th", {}, ["Vendor"]),
      el("th", {}, ["Model"]),
      el("th", {}, ["ID"]),
      el("th", {}, ["Excel match"]),
      el("th", {}, ["SCIPY commands"]),
    ])
  ]);

  const tbody = el("tbody", {}, []);
  for (const d of devices) {
    tbody.appendChild(el("tr", {}, [
      el("td", { class: "mono" }, [d.resource || ""]),
      el("td", {}, [d.vendor || ""]),
      el("td", {}, [d.model || ""]),
      el("td", { class: "mono" }, [d.id || ""]),
      el("td", {}, [
        d.found_in_excel
          ? el("span", { class: "ok" }, [`YES (${d.sheet})`])
          : el("span", { class: "no" }, ["NO"])
      ]),
      el("td", {}, [buildCommandsCell(d)]),
    ]));
  }

  table.appendChild(thead);
  table.appendChild(tbody);

  const wrap = document.getElementById("tableWrap");
  wrap.innerHTML = "";
  wrap.appendChild(table);
}

async function discover() {
  const status = document.getElementById("status");
  status.textContent = "discovering…";

  try {
    const resp = await postJson("/api/discover", {});
    renderDevices(resp.devices || []);
    status.textContent = `found ${resp.devices?.length ?? 0} devices`;
  } catch (e) {
    status.textContent = "ERR: " + e.message;
  }
}


function formatHistoryAsPython(history) {
  // Minimal “recipe” you can paste into a .py file
  // It outputs only the commands, grouped in order, with comments.
  let lines = [];
  lines.push("import pyvisa");
  lines.push("");
  lines.push("rm = pyvisa.ResourceManager()");
  lines.push("");
  lines.push("# Open instruments you used:");
  lines.push("# (edit timeout/terminations as needed)");
  lines.push("");

  // Collect unique resources in order of appearance
  const seen = new Set();
  for (const h of history) {
    if (!seen.has(h.resource)) {
      seen.add(h.resource);
      const varName = ("inst_" + seen.size).toUpperCase();
      lines.push(`${varName} = rm.open_resource(${JSON.stringify(h.resource)})`);
    }
  }

  lines.push("");
  lines.push("# Recipe:");
  let idx = 0;
  const resources = Array.from(seen);
  for (const h of history) {
    idx += 1;
    const instVar = ("inst_" + (resources.indexOf(h.resource) + 1)).toUpperCase();
    lines.push(`# ${idx}. ${h.ts}  ${h.get_set}  ${h.resource}`);
    if (h.get_set === "GET") {
      lines.push(`resp = ${instVar}.query(${JSON.stringify(h.sent)})`);
      lines.push(`print(resp.strip())`);
    } else {
      lines.push(`${instVar}.write(${JSON.stringify(h.sent)})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function refreshHistory() {
  const box = document.getElementById("historyBox");
  const status = document.getElementById("historyStatus");
  try {
    const r = await fetch("/api/history");
    const j = await r.json();
    const history = j.history || [];

    // Show a readable log in the textarea
    box.value = history.map(h => {
      const resp = (h.get_set === "GET" && h.response) ? `  -> ${h.response}` : "";
      return `${h.ts} | ${h.get_set} | ${h.resource} | ${h.sent}${resp}`;
    }).join("\n");

    status.textContent = `${history.length} entries`;
    window.__HISTORY__ = history;
  } catch (e) {
    status.textContent = "ERR: " + e.message;
  }
}

document.getElementById("copyHistoryBtn").addEventListener("click", async () => {
  // Ensure latest
  await refreshHistory();
  const py = formatHistoryAsPython(window.__HISTORY__ || []);
  await navigator.clipboard.writeText(py);
  document.getElementById("historyStatus").textContent = "Copied Python to clipboard";
});

document.getElementById("clearHistoryBtn").addEventListener("click", async () => {
  try {
    await postJson("/api/history/clear", {});
    await refreshHistory();
    document.getElementById("historyStatus").textContent = "Cleared";
  } catch (e) {
    document.getElementById("historyStatus").textContent = "ERR: " + e.message;
  }
});

// Initial load
refreshHistory();


document.getElementById("discoverBtn").addEventListener("click", discover);

if (Array.isArray(window.__DEVICES__) && window.__DEVICES__.length > 0) {
  renderDevices(window.__DEVICES__);
}
