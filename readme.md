# SCPI Excel Descriptor – Human Guide

This repository uses an **Excel-based SCPI descriptor** to define how laboratory instruments are controlled from the Flask web UI and from Python automation scripts.

The idea is simple:
- **Excel defines the instrument interface** (commands, parameters, UI layout)
- The **web UI and automation are generated from that Excel file**

This document explains **how to author and maintain** the Excel file.

---

## 1. Workbook structure

### One worksheet per instrument model

- Each **worksheet (tab)** represents **one instrument model**
- The **worksheet name must exactly match** the instrument’s reported `model` string

**Examples:**
- `KA3005P`
- `XDM2041`
- `SDG1032X`

If the model name matches a worksheet:
- The UI shows **“Excel Descriptor present”**
- Command buttons are generated automatically

If no worksheet exists:
- The device is still usable via **Custom CMD**

---

## 2. Required columns

Each worksheet must contain the following columns (case-insensitive):

| Column | Required | Description |
|------|---------|-------------|
| `Name` | ✅ | Button label shown in the UI |
| `GET/SET` | ✅ | Either `GET` or `SET` |
| `CMD` | ✅ | SCPI command template |
| `Parameter` or `Parameters` | ⬜ | Defines required input fields |

Additional columns are ignored.

---

## 3. Column definitions

### 3.1 `Name`

- Human-readable button label
- Keep it short and descriptive

**Examples:**
```
Read output voltage
Set desired output current
Set frequency
```

---

### 3.2 `GET/SET`

Defines how the command is executed:

- **GET**
  - Uses a SCPI query
  - Response is displayed in *Diagnostics*

- **SET**
  - Uses a SCPI write
  - No response is assumed unless the device replies

**Examples:**
```
GET
SET
```

---

### 3.3 `CMD` – SCPI command template

The exact SCPI command sent to the instrument.

#### Placeholders

- Parameters are written as **`{NAME}`**
- At runtime, placeholders are replaced with user-entered values

**Examples:**
```
MEAS:VOLT?
VSET1:{VOLT}
{CH}:BSWV FRQ,{FREQ}
```

Multiple placeholders are supported.

---

## 4. Parameter column – core concept

The `Parameter` / `Parameters` column defines **what input fields appear in the UI**.

### General rules

- Multiple parameters are separated by `|`
- Each parameter defines **one input control**
- Parameter names must match placeholders in `CMD`

---

## 5. Parameter types

### Case 1 – No parameters (empty cell)

If the `Parameter` cell is empty:
- No input field is shown
- Command is sent as-is

**Example:**
```
CMD: CONF:FREQ
Parameter: (empty)
```

---

### Case 2 – Free user input

If the parameter contains **no `:`**, it is a free text input.

**Syntax:**
```
PARAM_NAME
```

**Example:**
```
CMD: VSET1:{VOLT}
Parameter: VOLT
```

---

### Case 2b – Free input with numeric formatting

You can apply formatting using Python-style float precision.

**Syntax:**
```
PARAM_NAME:V.<decimals>f
```

**Example:**
```
CMD: ISET1:{CURRENT}
Parameter: CURRENT:V.3f
```

User input:
```
1.23456
```

Command sent:
```
ISET1:1.235
```

---

### Case 3 – Dropdown selection

If the parameter contains `:` **and** `;`, a dropdown is generated.

**Syntax:**
```
PARAM_NAME:opt1;opt2;opt3
```

**Example:**
```
CMD: CONF:VOLT {RANGE}
Parameter: RANGE:AUTO;500E-3;5;50;500;1000
```

---

## 6. Multiple parameters (advanced)

Multiple input fields can be defined using `|`.

**Example (dual-channel function generator):**
```
Name: Set frequency
GET/SET: SET
CMD: {CH}:BSWV FRQ,{FREQ}
Parameters: CH:C1;C2 | FREQ
```

UI behavior:
- Dropdown for `CH`: `C1`, `C2`
- Input field for `FREQ`

Command sent:
```
C1:BSWV FRQ,1000
```

---

## 7. Placeholder rules

- Placeholder names must exactly match parameter names

✅ Valid:
```
CMD: {A},{B}
Parameters: B | A
```

❌ Invalid:
```
CMD: {CHANNEL}
Parameters: CH
```

---

## 8. History & automation compatibility

Every UI action generates a reproducible Python command:

```python
setup.write('GEN','C1:BSWV FRQ,1000')
setup.query('DMM','MEAS:VOLT?')
```

This allows:
- Manual UI testing
- Copy–paste automation scripts

---

## 9. Best practices

- Keep worksheet names **exactly equal** to reported model strings
- Use explicit parameters instead of hard-coded values
- Use formatting (`V.2f`, `V.3f`) for physical quantities
- Test new commands using **Custom CMD** before adding them

---

## 10. Quick reference

| Goal | Parameter syntax |
|----|----|
| No input | *(empty)* |
| Free input | `VALUE` |
| Free input + format | `VALUE:V.2f` |
| Dropdown | `MODE:ON;OFF` |
| Multiple inputs | `CH:C1;C2 \| FREQ` |

---

**This Excel file is the single source of truth for the UI and automation.**

If the Excel descriptor is correct, everything else just works.

