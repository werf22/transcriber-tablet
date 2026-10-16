// dom.js — tiny DOM helpers shared by the views (no framework).
// h("div.cls", {attrs}, children…) builds elements; toast() shows a message;
// confirmDialog() replaces messagebox.askyesno from the Mac app.

export const $ = (sel, root = document) => root.querySelector(sel);

export function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split(".");
  const el = document.createElement(name);
  if (classes.length) el.className = classes.join(" ");
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k in el && k !== "list") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

let toastTimer = null;
export function toast(msg, { error = false, ms = 3500 } = {}) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("err", error);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), error ? Math.max(ms, 7000) : ms);
}

export function setStatus(msg) { $("#status").textContent = msg; }

export function confirmDialog(text) {
  const d = $("#confirm-dialog");
  $("#confirm-text").textContent = text;
  d.returnValue = "";
  d.showModal();
  return new Promise((resolve) => d.addEventListener("close", () => resolve(d.returnValue === "yes"), { once: true }));
}

/** Slovak plural: plural(n, "súbor", "súbory", "súborov") → 1 súbor, 3 súbory, 5 súborov. */
export const plural = (n, one, few, many) => `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;

export function humanSize(n) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return i === 0 ? `${Math.round(n)} B` : `${n.toFixed(1).replace(".", ",")} ${units[i]}`;
}

export function humanDuration(sec) {
  const s = Math.round(sec);
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = (x) => String(x).padStart(2, "0");
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
}
