/* ==========================================================
   Tiny Tribes – Excel download for orders
   Builds a real .xlsx file with several sheets:
   Summary, Orders (or Cancelled), Children and History.
   The Excel library (ExcelJS) loads only when someone
   presses the download button, so the dashboard stays fast.
   ========================================================== */

(function () {
  const LIB = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
  const LIB_HASH = "sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz";

  const RED = "FFDB2126";
  const CREAM = "FFFFF6E5";
  const GREEN = "FFDFF3E3";
  const PINK = "FFF3E0E0";
  const BLUE = "FFE3ECFF";

  let loading = null;
  function loadLib() {
    if (window.ExcelJS) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = LIB;
      s.integrity = LIB_HASH;
      s.crossOrigin = "anonymous";
      s.onload = resolve;
      s.onerror = () => {
        loading = null;
        reject(new Error("Could not load the Excel tool. Check the internet connection and try again."));
      };
      document.head.appendChild(s);
    });
    return loading;
  }

  // Excel has no time zones, so write the time as it shows on this computer (Kuwait time)
  const asDate = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  };
  const DATE_FMT = "dd mmm yyyy hh:mm";

  // Add a sheet with a styled header, frozen top row, filters and widths
  function addTable(wb, name, columns, rows, tabColor) {
    const ws = wb.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 1 }],
      properties: { tabColor: { argb: tabColor || RED } }
    });
    ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 16 }));
    rows.forEach((r) => ws.addRow(r));
    const header = ws.getRow(1);
    header.height = 22;
    header.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED } };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      if (c.money) col.numFmt = `#,##0.000 "${c.money}"`;
      if (c.date) col.numFmt = DATE_FMT;
      if (c.wrap) col.alignment = { wrapText: true, vertical: "top" };
    });
    if (rows.length) {
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    }
    return ws;
  }

  // Colour each order row by status so it is easy to scan
  function colourRows(ws, rows, colourFor) {
    rows.forEach((r, i) => {
      const argb = colourFor(r);
      if (!argb) return;
      ws.getRow(i + 2).eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
      });
    });
  }

  function summarySheet(wb, opts) {
    const { orders, currency, title, filters, by, cancelled } = opts;
    const ws = wb.addWorksheet("Summary", { properties: { tabColor: { argb: "FFF36C21" } } });
    ws.columns = [{ width: 34 }, { width: 18 }, { width: 22 }, { width: 22 }];
    const money = `#,##0.000 "${currency}"`;

    const titleRow = ws.addRow([title]);
    titleRow.font = { bold: true, size: 16, color: { argb: RED } };
    ws.addRow([`Downloaded ${new Date().toLocaleString("en-GB")} by ${by}`]).font = { italic: true, color: { argb: "FF666666" } };
    ws.addRow([filters ? `Search and filters used: ${filters}` : "All orders (no filters)"]).font = { italic: true, color: { argb: "FF666666" } };
    ws.addRow([]);

    const section = (text) => {
      const r = ws.addRow([text]);
      r.font = { bold: true, size: 12 };
      r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: CREAM } };
    };
    const head = (cells) => {
      const r = ws.addRow(cells);
      r.font = { bold: true, color: { argb: "FFFFFFFF" } };
      r.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED } }));
    };

    // Test orders are left out of the totals, unless the file has only test orders
    const onlyTests = orders.length > 0 && orders.every((o) => o.test);
    const real = onlyTests ? orders : orders.filter((o) => !o.test);
    const sum = (list) => list.reduce((n, o) => n + (Number(o.total) || 0), 0);
    const kids = (list) => list.reduce((n, o) => n + o.children.length, 0);

    section(onlyTests ? "Totals (this file has only test orders)" : "Totals (test orders not counted)");
    head(["", "Orders", "Children", "Amount"]);
    const line = (label, list) => {
      const r = ws.addRow([label, list.length, kids(list), sum(list)]);
      r.getCell(4).numFmt = money;
    };
    if (cancelled) {
      line("All cancelled orders", real);
      line("Refunded", real.filter((o) => o.refunded));
      line("Not refunded yet", real.filter((o) => !o.refunded));
    } else {
      line("All orders", real);
      line("Paid", real.filter((o) => String(o.status).startsWith("Paid")));
      line("Awaiting payment", real.filter((o) => o.status === "Awaiting payment"));
    }
    if (!onlyTests && orders.length !== real.length) ws.addRow([`Test orders in this file: ${orders.length - real.length}`]).font = { italic: true };
    ws.addRow([]);

    const groupBy = (label, keyFn) => {
      const map = new Map();
      real.forEach((o) => {
        const k = keyFn(o);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(o);
      });
      if (!map.size) return;
      section(label);
      head(["", "Orders", "Children", "Amount"]);
      [...map.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([k, list]) => line(k || "—", list));
      ws.addRow([]);
    };
    groupBy("By program and option", (o) => `${o.programName} · ${o.optionLabel}`);
    groupBy("By status", (o) => o.status);
    groupBy("By payment method", (o) => o.method || "Not paid yet");

    // Children by age group
    const ages = new Map();
    real.forEach((o) => o.children.forEach((c) => ages.set(c.age || "—", (ages.get(c.age || "—") || 0) + 1)));
    if (ages.size) {
      section("Children by age group");
      head(["Age group", "Children"]);
      [...ages.entries()].sort().forEach(([a, n]) => ws.addRow([a, n]));
    }
  }

  /* kind: "orders" or "cancelled"
     opts: { orders, currency, filters, by, history, fileName } */
  async function download(kind, opts) {
    await loadLib();
    const { orders, currency, history } = opts;
    const cancelled = kind === "cancelled";
    const wb = new window.ExcelJS.Workbook();
    wb.creator = "Tiny Tribes dashboard";
    wb.created = new Date();

    summarySheet(wb, Object.assign({ title: cancelled ? "Tiny Tribes – cancelled orders" : "Tiny Tribes – orders", cancelled }, opts));

    // One row per order
    const orderCols = [
      { header: "Reference", key: "id", width: 20 },
      { header: "Order date", key: "createdAt", width: 19, date: true },
      { header: "Status", key: "status", width: 18 },
      { header: "Test order", key: "test", width: 11 },
      { header: "Program", key: "program", width: 16 },
      { header: "Option / week", key: "option", width: 30 },
      { header: "Children", key: "count", width: 10 },
      { header: "Price per child", key: "unit", width: 16, money: currency },
      { header: "Total", key: "total", width: 16, money: currency },
      { header: "Payment method", key: "method", width: 15 },
      { header: "Paid on", key: "paidAt", width: 19, date: true },
      { header: "Parent name", key: "parent", width: 22 },
      { header: "Phone", key: "phone", width: 17 },
      { header: "Email", key: "email", width: 26 },
      { header: "Emergency phone", key: "emergency", width: 17 },
      { header: "Children (name – age)", key: "kids", width: 40, wrap: true },
      { header: "Notes", key: "notes", width: 34, wrap: true }
    ];
    if (cancelled) {
      orderCols.push(
        { header: "Status before cancelling", key: "before", width: 20 },
        { header: "Cancelled on", key: "cancelledAt", width: 19, date: true },
        { header: "Cancelled by", key: "cancelledBy", width: 18 },
        { header: "Cancellation reason", key: "reason", width: 40, wrap: true },
        { header: "Refunded", key: "refunded", width: 12 },
        { header: "Refunded on", key: "refundedAt", width: 19, date: true },
        { header: "Refunded by", key: "refundedBy", width: 18 }
      );
    }
    const orderRows = orders.map((o) => ({
      id: o.id,
      createdAt: asDate(o.createdAt),
      status: o.status,
      test: o.test ? "Yes" : "",
      program: o.programName,
      option: o.optionLabel,
      count: o.children.length,
      unit: Number(o.unitPrice) || 0,
      total: Number(o.total) || 0,
      method: o.method || "",
      paidAt: asDate(o.paidAt),
      parent: o.parent.name,
      phone: o.parent.phone,
      email: o.parent.email,
      emergency: o.parent.emergency,
      kids: o.children.map((c) => `${c.name} – ${c.age}`).join("\n"),
      notes: o.children.filter((c) => c.notes).map((c) => `${c.name}: ${c.notes}`).join("\n"),
      before: o.statusBeforeCancel || "",
      cancelledAt: asDate(o.cancelledAt),
      cancelledBy: o.cancelledBy || "",
      reason: o.cancelReason || "",
      refunded: o.refunded ? "Yes" : "No",
      refundedAt: asDate(o.refundedAt),
      refundedBy: o.refundedBy || ""
    }));
    const ws = addTable(wb, cancelled ? "Cancelled orders" : "Orders", orderCols, orderRows);
    colourRows(ws, orders, (o) =>
      o.test ? BLUE : cancelled ? (o.refunded ? GREEN : PINK) : String(o.status).startsWith("Paid") ? GREEN : null
    );
    // Totals row under the orders
    if (orders.length) {
      const totalRow = ws.addRow({ id: "TOTAL", count: { formula: `SUM(G2:G${orders.length + 1})` }, total: { formula: `SUM(I2:I${orders.length + 1})` } });
      totalRow.font = { bold: true };
      totalRow.eachCell({ includeEmpty: true }, (c) => (c.border = { top: { style: "medium" } }));
    }

    // One row per child: handy for attendance and groups
    const childCols = [
      { header: "Child name", key: "name", width: 24 },
      { header: "Age group", key: "age", width: 13 },
      { header: "Notes (allergies etc.)", key: "notes", width: 34, wrap: true },
      { header: "Program", key: "program", width: 16 },
      { header: "Option / week", key: "option", width: 30 },
      { header: "Order status", key: "status", width: 18 },
      { header: "Reference", key: "id", width: 20 },
      { header: "Parent name", key: "parent", width: 22 },
      { header: "Parent phone", key: "phone", width: 17 },
      { header: "Emergency phone", key: "emergency", width: 17 },
      { header: "Test order", key: "test", width: 11 }
    ];
    const childRows = [];
    orders.forEach((o) =>
      o.children.forEach((c) =>
        childRows.push({
          name: c.name, age: c.age, notes: c.notes, program: o.programName, option: o.optionLabel, status: o.status,
          id: o.id, parent: o.parent.name, phone: o.parent.phone, emergency: o.parent.emergency, test: o.test ? "Yes" : ""
        })
      )
    );
    addTable(wb, "Children", childCols, childRows, "FFFBAA1E");

    // Every recorded change to these orders
    if (history) {
      const ids = new Set(orders.map((o) => o.id));
      const histRows = history
        .filter((h) => ids.has(h.target))
        .map((h) => ({ at: asDate(h.at), id: h.target, by: h.by, action: h.action, from: h.from || "", to: h.to || "" }));
      addTable(
        wb,
        "Order history", // "History" alone is a name Excel keeps for itself
        [
          { header: "When", key: "at", width: 19, date: true },
          { header: "Reference", key: "id", width: 20 },
          { header: "Who", key: "by", width: 18 },
          { header: "What happened", key: "action", width: 42, wrap: true },
          { header: "From", key: "from", width: 24, wrap: true },
          { header: "To", key: "to", width: 30, wrap: true }
        ],
        histRows,
        "FF7A7A7A"
      );
    }

    const buffer = await wb.xlsx.writeBuffer();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = opts.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  window.TTExcel = { download };
})();
